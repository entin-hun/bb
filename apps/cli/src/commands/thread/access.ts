import { Command } from "commander";
import {
  threadInviteRoleSchema,
  threadParticipantRoleSchema,
  type ThreadInviteRole,
  type ThreadParticipantRole,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson } from "../helpers.js";

interface JsonOptions {
  json?: boolean;
}

interface InviteCreateOptions extends JsonOptions {
  email?: string;
  expires?: string;
  role?: string;
}

interface ParticipantAddOptions extends JsonOptions {
  role?: string;
}

function inviteRole(value: string | undefined): ThreadInviteRole {
  return threadInviteRoleSchema.parse(value ?? "member");
}

function participantRole(value: string): ThreadParticipantRole {
  return threadParticipantRoleSchema.parse(value);
}

function expiresInHours(value: string | undefined): number {
  if (value === undefined) return 24;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
    throw new Error("--expires must be a whole number of hours from 1 to 168");
  }
  return parsed;
}

export function registerThreadAccessCommands(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("access <thread-id>")
    .description("Show participants, roles, and active invitations")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.access.get({
          threadId,
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  const participant = parent
    .command("participant")
    .description("Manage thread participants");
  participant
    .command("add <thread-id> <email>")
    .description("Assign an Authentik user who has signed in before")
    .option("--role <role>", "Role: maintainer, member, or viewer", "member")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string,
          email: string,
          opts: ParticipantAddOptions,
        ) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.access.addParticipant({
            email,
            role: inviteRole(opts.role),
            threadId,
          });
          if (outputJson(opts, result)) return;
          console.log(`${result.email} is now ${result.role} on ${threadId}`);
        },
      ),
    );
  participant
    .command("role <thread-id> <user-id> <role>")
    .description("Change a participant role")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string,
          userId: string,
          role: string,
          opts: JsonOptions,
        ) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.access.updateParticipant({
            role: participantRole(role),
            threadId,
            userId,
          });
          if (outputJson(opts, result)) return;
          console.log(`${result.email} is now ${result.role} on ${threadId}`);
        },
      ),
    );
  participant
    .command("remove <thread-id> <user-id>")
    .description("Remove a participant from a thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, userId: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.access.removeParticipant({
          threadId,
          userId,
        });
        if (outputJson(opts, result)) return;
        console.log(`Removed ${userId} from ${threadId}`);
      }),
    );

  const invite = parent
    .command("invite")
    .description("Manage thread invitations");
  invite
    .command("create <thread-id>")
    .description("Create a single-use thread invitation")
    .option("--email <email>", "Restrict the invitation to an email address")
    .option("--role <role>", "Role: maintainer, member, or viewer", "member")
    .option("--expires <hours>", "Expiry in hours, from 1 to 168", "24")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: InviteCreateOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.access.createInvite({
          email: opts.email?.trim().toLowerCase() ?? null,
          expiresInHours: expiresInHours(opts.expires),
          role: inviteRole(opts.role),
          threadId,
        });
        if (outputJson(opts, result)) return;
        console.log(result.url);
      }),
    );
  invite
    .command("revoke <thread-id> <invite-id>")
    .description("Revoke an unused invitation")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, inviteId: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.access.revokeInvite({
          inviteId,
          threadId,
        });
        if (outputJson(opts, result)) return;
        console.log(`Revoked invitation ${inviteId}`);
      }),
    );
  invite
    .command("preview <token>")
    .description("Inspect an invitation without accepting it")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (token: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.access.previewInvite({ token });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );
  invite
    .command("accept <token>")
    .description("Accept an invitation with BB_AUTHENTIK_SESSION")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (token: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.access.acceptInvite({ token });
        if (outputJson(opts, result)) return;
        console.log(`Joined ${result.threadId} as ${result.role}`);
      }),
    );
}
