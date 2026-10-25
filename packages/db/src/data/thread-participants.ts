import { and, eq, isNull, notExists } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { authUsers, threadParticipants, threads } from "../schema.js";

export const threadParticipantRoles = [
  "owner",
  "maintainer",
  "member",
  "viewer",
] as const;

export type ThreadParticipantRole = (typeof threadParticipantRoles)[number];

export function getActiveThreadParticipant(
  db: DbConnection,
  args: { threadId: string; userId: string },
) {
  return db
    .select()
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.threadId, args.threadId),
        eq(threadParticipants.userId, args.userId),
        isNull(threadParticipants.revokedAt),
      ),
    )
    .get() ?? null;
}

export function listActiveThreadParticipants(db: DbConnection, threadId: string) {
  return db
    .select({
      createdAt: threadParticipants.createdAt,
      email: authUsers.email,
      name: authUsers.name,
      role: threadParticipants.role,
      threadId: threadParticipants.threadId,
      updatedAt: threadParticipants.updatedAt,
      userId: threadParticipants.userId,
    })
    .from(threadParticipants)
    .innerJoin(authUsers, eq(authUsers.id, threadParticipants.userId))
    .where(
      and(
        eq(threadParticipants.threadId, threadId),
        isNull(threadParticipants.revokedAt),
      ),
    )
    .all();
}

export function listAccessibleThreadIds(db: DbConnection, userId: string) {
  return db
    .select({ threadId: threadParticipants.threadId })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.userId, userId),
        isNull(threadParticipants.revokedAt),
      ),
    )
    .all()
    .map((row) => row.threadId);
}

export function copyThreadParticipants(
  db: DbConnection,
  args: { fromThreadId: string; toThreadId: string },
): number {
  const participants = db
    .select({ role: threadParticipants.role, userId: threadParticipants.userId })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.threadId, args.fromThreadId),
        isNull(threadParticipants.revokedAt),
      ),
    )
    .all();
  for (const participant of participants) {
    upsertThreadParticipant(db, {
      role: participant.role,
      threadId: args.toThreadId,
      userId: participant.userId,
    });
  }
  return participants.length;
}

export function bootstrapLegacyThreadOwners(
  db: DbConnection,
  userId: string,
): number {
  const legacyThreads = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        isNull(threads.deletedAt),
        notExists(
          db
            .select({ threadId: threadParticipants.threadId })
            .from(threadParticipants)
            .where(
              and(
                eq(threadParticipants.threadId, threads.id),
                isNull(threadParticipants.revokedAt),
              ),
            ),
        ),
      ),
    )
    .all();
  for (const thread of legacyThreads) {
    upsertThreadParticipant(db, {
      role: "owner",
      threadId: thread.id,
      userId,
    });
  }
  return legacyThreads.length;
}

export function upsertThreadParticipant(
  db: DbConnection,
  args: { role: ThreadParticipantRole; threadId: string; userId: string },
) {
  const now = Date.now();
  db.insert(threadParticipants)
    .values({ ...args, createdAt: now, revokedAt: null, updatedAt: now })
    .onConflictDoUpdate({
      target: [threadParticipants.threadId, threadParticipants.userId],
      set: { role: args.role, revokedAt: null, updatedAt: now },
    })
    .run();
  return getActiveThreadParticipant(db, args);
}

export function revokeThreadParticipant(
  db: DbConnection,
  args: { threadId: string; userId: string },
): boolean {
  const changed = db
    .update(threadParticipants)
    .set({ revokedAt: Date.now(), updatedAt: Date.now() })
    .where(
      and(
        eq(threadParticipants.threadId, args.threadId),
        eq(threadParticipants.userId, args.userId),
        isNull(threadParticipants.revokedAt),
      ),
    )
    .run();
  return changed.changes > 0;
}
