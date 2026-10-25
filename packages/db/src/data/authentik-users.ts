import { and, eq, gt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DbConnection } from "../connection.js";
import { authentikIdentities, authUsers, userSessions } from "../schema.js";

export function upsertAuthentikUser(
  db: DbConnection,
  args: { email: string; issuer: string; name: string; subject: string },
) {
  const now = Date.now();
  const email = args.email.trim().toLowerCase();
  const identity = db.select().from(authentikIdentities).where(and(eq(authentikIdentities.issuer, args.issuer), eq(authentikIdentities.subject, args.subject))).get();
  const existingUser = db.select().from(authUsers).where(eq(authUsers.email, email)).get();
  const userId = identity?.userId ?? existingUser?.id ?? randomUUID();
  db.insert(authUsers).values({ id: userId, email, emailVerified: true, image: null, name: args.name, createdAt: new Date(now), updatedAt: new Date(now) }).onConflictDoUpdate({ target: authUsers.id, set: { email, emailVerified: true, name: args.name, updatedAt: new Date(now) } }).run();
  db.insert(authentikIdentities).values({ issuer: args.issuer, subject: args.subject, userId, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [authentikIdentities.issuer, authentikIdentities.subject], set: { userId, updatedAt: now } }).run();
  return db.select().from(authUsers).where(eq(authUsers.id, userId)).get()!;
}

export function createUserSession(db: DbConnection, args: { expiresAt: number; userId: string }) {
  const id = randomUUID();
  db.insert(userSessions).values({ id, userId: args.userId, expiresAt: args.expiresAt, createdAt: Date.now() }).run();
  return id;
}

export function getActiveUserSession(db: DbConnection, id: string) {
  return db.select({ user: authUsers, session: userSessions }).from(userSessions).innerJoin(authUsers, eq(authUsers.id, userSessions.userId)).where(and(eq(userSessions.id, id), gt(userSessions.expiresAt, Date.now()))).get() ?? null;
}

export function deleteUserSession(db: DbConnection, id: string): void {
  db.delete(userSessions).where(eq(userSessions.id, id)).run();
}

export function getAuthUserById(db: DbConnection, id: string) {
  return db.select().from(authUsers).where(eq(authUsers.id, id)).get() ?? null;
}

export function getAuthUserByEmail(db: DbConnection, email: string) {
  return db
    .select()
    .from(authUsers)
    .where(eq(authUsers.email, email.trim().toLowerCase()))
    .get() ?? null;
}
