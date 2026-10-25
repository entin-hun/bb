import { describe, expect, it } from "vitest";
import {
  acceptThreadInvite,
  copyThreadParticipants,
  createProject,
  createThread,
  createThreadInvite,
  getActiveThreadInviteByTokenHash,
  listAccessibleThreadIds,
  listActiveThreadParticipants,
  noopNotifier,
  upsertAuthentikUser,
  upsertHost,
  upsertThreadParticipant,
} from "../../src/index.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "access-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "Access project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/access" },
  });
  const parent = createThread(db, noopNotifier, {
    environmentId: null,
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  const child = createThread(db, noopNotifier, {
    environmentId: null,
    parentThreadId: parent.id,
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  return { child, db, parent };
}

describe("thread access persistence", () => {
  it("assigns roles and copies active participants to agent child threads", () => {
    const { child, db, parent } = setup();
    const owner = upsertAuthentikUser(db, {
      email: "owner@example.test",
      issuer: "https://auth.example.test/application/o/bb/",
      name: "Owner",
      subject: "owner",
    });
    const member = upsertAuthentikUser(db, {
      email: "member@example.test",
      issuer: "https://auth.example.test/application/o/bb/",
      name: "Member",
      subject: "member",
    });
    upsertThreadParticipant(db, { role: "owner", threadId: parent.id, userId: owner.id });
    upsertThreadParticipant(db, { role: "member", threadId: parent.id, userId: member.id });

    expect(copyThreadParticipants(db, {
      fromThreadId: parent.id,
      toThreadId: child.id,
    })).toBe(2);
    expect(listActiveThreadParticipants(db, child.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "owner", userId: owner.id }),
        expect.objectContaining({ role: "member", userId: member.id }),
      ]),
    );
    expect(listAccessibleThreadIds(db, member.id)).toEqual(
      expect.arrayContaining([parent.id, child.id]),
    );
  });

  it("stores only token hashes and consumes an invitation once", () => {
    const { db, parent } = setup();
    const owner = upsertAuthentikUser(db, {
      email: "owner@example.test",
      issuer: "https://auth.example.test/application/o/bb/",
      name: "Owner",
      subject: "owner",
    });
    const member = upsertAuthentikUser(db, {
      email: "member@example.test",
      issuer: "https://auth.example.test/application/o/bb/",
      name: "Member",
      subject: "member",
    });
    const invite = createThreadInvite(db, {
      createdByUserId: owner.id,
      email: member.email,
      expiresAt: Date.now() + 60_000,
      role: "member",
      threadId: parent.id,
      tokenHash: "hashed-token",
    });

    expect(getActiveThreadInviteByTokenHash(db, "hashed-token")?.id).toBe(invite.id);
    expect(getActiveThreadInviteByTokenHash(db, "raw-token")).toBeNull();
    expect(acceptThreadInvite(db, { id: invite.id, userId: member.id })).toBe(true);
    expect(acceptThreadInvite(db, { id: invite.id, userId: owner.id })).toBe(false);
    expect(getActiveThreadInviteByTokenHash(db, "hashed-token")).toBeNull();
  });
});
