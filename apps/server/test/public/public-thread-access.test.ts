import {
  createTerminalSession,
  createUserSession,
  upsertAuthentikUser,
  upsertThreadParticipant,
} from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const authEnvironment = {
  BB_AUTHENTIK_ISSUER: "https://auth.example.test/application/o/bb/",
  BB_AUTHENTIK_CLIENT_ID: "bb-test",
  BB_AUTHENTIK_CLIENT_SECRET: "test-secret",
  BB_PUBLIC_ORIGIN: "https://bb.example.test",
} as const;

const previousEnvironment = Object.fromEntries(
  Object.keys(authEnvironment).map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function authenticatedHarness(): Promise<TestAppHarness> {
  Object.assign(process.env, authEnvironment);
  return createTestAppHarness();
}

function userSession(
  harness: TestAppHarness,
  args: {
    email: string;
    role?: "owner" | "maintainer" | "member" | "viewer";
    threadId?: string;
  },
) {
  const user = upsertAuthentikUser(harness.db, {
    email: args.email,
    issuer: authEnvironment.BB_AUTHENTIK_ISSUER,
    name: args.email.split("@")[0] ?? args.email,
    subject: args.email,
  });
  if (args.role && args.threadId) {
    upsertThreadParticipant(harness.db, {
      role: args.role,
      threadId: args.threadId,
      userId: user.id,
    });
  }
  const session = createUserSession(harness.db, {
    expiresAt: Date.now() + 60_000,
    userId: user.id,
  });
  return { cookie: `bb_authentik_session=${session}`, user };
}

function request(
  harness: TestAppHarness,
  path: string,
  cookie: string,
  init: RequestInit = {},
) {
  return harness.app.request(`https://bb.example.test/api/v1${path}`, {
    ...init,
    headers: {
      cookie,
      origin: "https://bb.example.test",
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init.headers,
    },
  });
}

describe.sequential("Authentik thread roles", () => {
  it("enforces viewer, member, maintainer, and owner capabilities end to end", async () => {
    const harness = await authenticatedHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });
      const owner = userSession(harness, {
        email: "owner@example.test",
        role: "owner",
        threadId: thread.id,
      });
      const maintainer = userSession(harness, {
        email: "maintainer@example.test",
        role: "maintainer",
        threadId: thread.id,
      });
      const member = userSession(harness, {
        email: "member@example.test",
        role: "member",
        threadId: thread.id,
      });
      const viewer = userSession(harness, {
        email: "viewer@example.test",
        role: "viewer",
        threadId: thread.id,
      });
      const outsider = userSession(harness, { email: "outsider@example.test" });

      for (const actor of [owner, maintainer, member, viewer]) {
        expect(
          (await request(harness, `/threads/${thread.id}`, actor.cookie))
            .status,
        ).toBe(200);
      }
      expect(
        (await request(harness, `/threads/${thread.id}`, outsider.cookie))
          .status,
      ).toBe(404);

      const patch = (actor: typeof owner) =>
        request(harness, `/threads/${thread.id}`, actor.cookie, {
          method: "PATCH",
          body: JSON.stringify({ title: "Shared title" }),
        });
      expect((await patch(owner)).status).toBe(200);
      expect((await patch(maintainer)).status).toBe(200);
      expect((await patch(member)).status).toBe(403);
      expect((await patch(viewer)).status).toBe(403);

      const invite = (actor: typeof owner) =>
        request(harness, `/threads/${thread.id}/invites`, actor.cookie, {
          method: "POST",
          body: JSON.stringify({
            email: null,
            expiresInHours: 24,
            role: "member",
          }),
        });
      expect((await invite(owner)).status).toBe(201);
      expect((await invite(maintainer)).status).toBe(201);
      expect((await invite(member)).status).toBe(403);

      const ownerOnly = (actor: typeof owner) =>
        request(
          harness,
          `/threads/${thread.id}/participants/${viewer.user.id}`,
          actor.cookie,
          { method: "PATCH", body: JSON.stringify({ role: "viewer" }) },
        );
      expect((await ownerOnly(maintainer)).status).toBe(403);
      expect((await ownerOnly(owner)).status).toBe(200);

      const retry = (actor: typeof owner) =>
        request(harness, `/threads/${thread.id}/retry`, actor.cookie, {
          method: "POST",
          body: JSON.stringify({
            reason: "role test",
            sendAt: null,
            turnRequestId: null,
          }),
        });
      expect((await retry(member)).status).not.toBe(403);
      expect((await retry(viewer)).status).toBe(403);
      expect(
        (
          await request(harness, `/threads/${thread.id}`, maintainer.cookie, {
            method: "DELETE",
            body: JSON.stringify({ childThreadsConfirmed: false }),
          })
        ).status,
      ).toBe(403);
    } finally {
      await harness.cleanup();
    }
  });

  it("accepts an email-bound invitation once and exposes only authorized threads", async () => {
    const harness = await authenticatedHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const shared = seedThread(harness.deps, { projectId: project.id });
      const privateThread = seedThread(harness.deps, { projectId: project.id });
      const owner = userSession(harness, {
        email: "owner@example.test",
        role: "owner",
        threadId: shared.id,
      });
      const invited = userSession(harness, { email: "invited@example.test" });
      const wrong = userSession(harness, { email: "wrong@example.test" });
      const response = await request(
        harness,
        `/threads/${shared.id}/invites`,
        owner.cookie,
        {
          method: "POST",
          body: JSON.stringify({
            email: invited.user.email,
            expiresInHours: 24,
            role: "viewer",
          }),
        },
      );
      expect(response.status).toBe(201);
      const created = (await readJson(response)) as { url: string };
      const token = created.url.split("/").at(-1);
      expect(token).toBeTruthy();

      expect(
        (
          await request(
            harness,
            `/thread-invites/${token}/accept`,
            wrong.cookie,
            { method: "POST" },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            harness,
            `/thread-invites/${token}/accept`,
            invited.cookie,
            { method: "POST" },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            harness,
            `/thread-invites/${token}/accept`,
            invited.cookie,
            { method: "POST" },
          )
        ).status,
      ).toBe(404);

      const listResponse = await request(harness, "/threads", invited.cookie);
      expect(listResponse.status).toBe(200);
      const rows = (await readJson(listResponse)) as Array<{ id: string }>;
      expect(rows.map((row) => row.id)).toContain(shared.id);
      expect(rows.map((row) => row.id)).not.toContain(privateThread.id);
    } finally {
      await harness.cleanup();
    }
  });

  it("applies thread roles to terminal HTTP access and rejects unscoped terminals", async () => {
    const harness = await authenticatedHarness();
    try {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });
      const member = userSession(harness, {
        email: "member@example.test",
        role: "member",
        threadId: thread.id,
      });
      const viewer = userSession(harness, {
        email: "viewer@example.test",
        role: "viewer",
        threadId: thread.id,
      });
      const outsider = userSession(harness, { email: "outsider@example.test" });
      const attached = createTerminalSession(harness.db, {
        cols: 80,
        daemonSessionId: null,
        environmentId: null,
        hostId: host.id,
        initialCwd: "/tmp",
        rows: 24,
        status: "starting",
        threadId: thread.id,
        title: "Shared terminal",
      });
      const unscoped = createTerminalSession(harness.db, {
        cols: 80,
        daemonSessionId: null,
        environmentId: null,
        hostId: host.id,
        initialCwd: "/tmp",
        rows: 24,
        status: "starting",
        threadId: null,
        title: "Host terminal",
      });

      expect(
        (await request(harness, `/terminals/${attached.id}`, viewer.cookie))
          .status,
      ).toBe(200);
      expect(
        (
          await request(harness, `/terminals/${attached.id}`, viewer.cookie, {
            method: "PATCH",
            body: JSON.stringify({ title: "Denied" }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(harness, `/terminals/${attached.id}`, member.cookie, {
            method: "PATCH",
            body: JSON.stringify({ title: "Allowed" }),
          })
        ).status,
      ).toBe(200);
      expect(
        (await request(harness, `/terminals/${attached.id}`, outsider.cookie))
          .status,
      ).toBe(404);
      expect(
        (await request(harness, `/terminals/${unscoped.id}`, member.cookie))
          .status,
      ).toBe(403);
    } finally {
      await harness.cleanup();
    }
  });
});
