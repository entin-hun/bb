import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DbConnection } from "../connection.js";
import { threadInvites } from "../schema.js";
import type { ThreadParticipantRole } from "./thread-participants.js";

export type ThreadInviteRole = Exclude<ThreadParticipantRole, "owner">;

export function createThreadInvite(
  db: DbConnection,
  args: {
    createdByUserId: string;
    email: string | null;
    expiresAt: number;
    role: ThreadInviteRole;
    threadId: string;
    tokenHash: string;
  },
) {
  const invite = { id: randomUUID(), ...args, createdAt: Date.now() };
  db.insert(threadInvites).values(invite).run();
  return invite;
}

export function listThreadInvites(db: DbConnection, threadId: string) {
  return db
    .select({
      acceptedAt: threadInvites.acceptedAt,
      acceptedByUserId: threadInvites.acceptedByUserId,
      createdAt: threadInvites.createdAt,
      email: threadInvites.email,
      expiresAt: threadInvites.expiresAt,
      id: threadInvites.id,
      revokedAt: threadInvites.revokedAt,
      role: threadInvites.role,
      threadId: threadInvites.threadId,
    })
    .from(threadInvites)
    .where(eq(threadInvites.threadId, threadId))
    .orderBy(desc(threadInvites.createdAt))
    .all();
}

export function getActiveThreadInviteByTokenHash(
  db: DbConnection,
  tokenHash: string,
) {
  return db
    .select()
    .from(threadInvites)
    .where(
      and(
        eq(threadInvites.tokenHash, tokenHash),
        gt(threadInvites.expiresAt, Date.now()),
        isNull(threadInvites.acceptedAt),
        isNull(threadInvites.revokedAt),
      ),
    )
    .get() ?? null;
}

export function acceptThreadInvite(
  db: DbConnection,
  args: { id: string; userId: string },
): boolean {
  return db
    .update(threadInvites)
    .set({ acceptedAt: Date.now(), acceptedByUserId: args.userId })
    .where(
      and(
        eq(threadInvites.id, args.id),
        gt(threadInvites.expiresAt, Date.now()),
        isNull(threadInvites.acceptedAt),
        isNull(threadInvites.revokedAt),
      ),
    )
    .run().changes > 0;
}

export function revokeThreadInvite(
  db: DbConnection,
  args: { id: string; threadId: string },
): boolean {
  return db
    .update(threadInvites)
    .set({ revokedAt: Date.now() })
    .where(
      and(
        eq(threadInvites.id, args.id),
        eq(threadInvites.threadId, args.threadId),
        isNull(threadInvites.acceptedAt),
        isNull(threadInvites.revokedAt),
      ),
    )
    .run().changes > 0;
}
