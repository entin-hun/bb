import {
  getActiveThreadParticipant,
  listAccessibleThreadIds,
  threadParticipantRoles,
  type ThreadParticipantRole,
} from "@bb/db";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { getRequestAuthentikUser } from "./authentik.js";

export type ThreadCapability = "read" | "post" | "manage" | "own";

const minimumRole: Record<ThreadCapability, ThreadParticipantRole> = {
  read: "viewer",
  post: "member",
  manage: "maintainer",
  own: "owner",
};

const roleRank = new Map(
  threadParticipantRoles.map((role, index) => [
    role,
    threadParticipantRoles.length - index,
  ]),
);

export function requestThreadUserId(context: object): string | null {
  return getRequestAuthentikUser(context)?.id ?? null;
}

export function requestAccessibleThreadIds(
  deps: Pick<AppDeps, "db">,
  context: object,
): string[] | null {
  const userId = requestThreadUserId(context);
  return userId === null ? null : listAccessibleThreadIds(deps.db, userId);
}

export function requireThreadCapability(
  deps: Pick<AppDeps, "db">,
  context: object,
  threadId: string,
  capability: ThreadCapability,
) {
  const userId = requestThreadUserId(context);
  if (userId === null) return null;
  const participant = getActiveThreadParticipant(deps.db, { threadId, userId });
  const allowed =
    participant !== null &&
    (roleRank.get(participant.role) ?? 0) >=
      (roleRank.get(minimumRole[capability]) ?? 0);
  if (!allowed) {
    if (capability === "read") {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    throw new ApiError(
      403,
      "forbidden",
      `Thread role does not allow ${capability}`,
    );
  }
  return participant;
}

export function userHasThreadCapability(
  deps: Pick<AppDeps, "db">,
  userId: string,
  threadId: string,
  capability: ThreadCapability,
): boolean {
  const participant = getActiveThreadParticipant(deps.db, { threadId, userId });
  return (
    participant !== null &&
    (roleRank.get(participant.role) ?? 0) >=
      (roleRank.get(minimumRole[capability]) ?? 0)
  );
}

export function threadCapabilityForRequest(
  method: string,
  path: string,
): ThreadCapability {
  if (method === "GET") return "read";
  if (path.endsWith("/archive-all")) return "read";
  if (
    /\/(?:send|retry|messages|queued-messages|interactions)(?:\/|$)/u.test(path)
  ) {
    return "post";
  }
  if (/\/invites(?:\/|$)/u.test(path)) return "manage";
  if (method === "DELETE") return "own";
  if (method === "PATCH") return "manage";
  return "manage";
}
