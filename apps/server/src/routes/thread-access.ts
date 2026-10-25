import { createHash, randomBytes } from "node:crypto";
import {
  acceptThreadInvite,
  createThreadInvite,
  getActiveThreadInviteByTokenHash,
  getAuthUserByEmail,
  listActiveThreadParticipants,
  listThreadInvites,
  revokeThreadInvite,
  revokeThreadParticipant,
  upsertThreadParticipant,
} from "@bb/db";
import type { Hono } from "hono";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { requireRequestAuthentikUser } from "../services/authentik.js";
import { requireThreadCapability } from "../services/thread-access.js";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requireParticipantRow(
  deps: Pick<AppDeps, "db">,
  threadId: string,
  userId: string,
) {
  const participant = listActiveThreadParticipants(deps.db, threadId).find(
    (row) => row.userId === userId,
  );
  if (!participant) {
    throw new ApiError(
      404,
      "participant_not_found",
      "Thread participant not found",
    );
  }
  return participant;
}

function requireAnotherOwner(
  deps: Pick<AppDeps, "db">,
  threadId: string,
  userId: string,
): void {
  const hasAnotherOwner = listActiveThreadParticipants(deps.db, threadId).some(
    (row) => row.role === "owner" && row.userId !== userId,
  );
  if (!hasAnotherOwner) {
    throw new ApiError(
      409,
      "last_owner",
      "A thread must keep at least one owner",
    );
  }
}

export function registerThreadAccessRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.threadAccess;

  get(routes.get, (context) => {
    const threadId = context.req.param("id");
    const current = requireThreadCapability(deps, context, threadId, "read");
    const canManage =
      current === null ||
      current.role === "owner" ||
      current.role === "maintainer";
    return context.json({
      currentRole: current?.role ?? null,
      invites: canManage ? listThreadInvites(deps.db, threadId) : [],
      participants: listActiveThreadParticipants(deps.db, threadId),
    });
  });

  post(routes.addParticipant, (context, payload) => {
    const threadId = context.req.param("id");
    requireThreadCapability(deps, context, threadId, "manage");
    const user = getAuthUserByEmail(deps.db, payload.email);
    if (!user) {
      throw new ApiError(
        404,
        "user_not_found",
        "That user must sign in once before direct assignment",
      );
    }
    upsertThreadParticipant(deps.db, {
      role: payload.role,
      threadId,
      userId: user.id,
    });
    return context.json(requireParticipantRow(deps, threadId, user.id), 201);
  });

  patch(routes.updateParticipant, (context, payload) => {
    const threadId = context.req.param("id");
    requireThreadCapability(deps, context, threadId, "own");
    const userId = context.req.param("userId");
    const existing = requireParticipantRow(deps, threadId, userId);
    if (existing.role === "owner" && payload.role !== "owner") {
      requireAnotherOwner(deps, threadId, userId);
    }
    upsertThreadParticipant(deps.db, { role: payload.role, threadId, userId });
    return context.json(requireParticipantRow(deps, threadId, userId));
  });

  del(routes.removeParticipant, (context) => {
    const threadId = context.req.param("id");
    requireThreadCapability(deps, context, threadId, "own");
    const userId = context.req.param("userId");
    const existing = requireParticipantRow(deps, threadId, userId);
    if (existing.role === "owner") requireAnotherOwner(deps, threadId, userId);
    deps.hub.notifyThread(threadId, ["read-state-changed"]);
    if (!revokeThreadParticipant(deps.db, { threadId, userId })) {
      throw new ApiError(
        404,
        "participant_not_found",
        "Thread participant not found",
      );
    }
    return context.json({ ok: true as const });
  });

  post(routes.createInvite, (context, payload) => {
    const threadId = context.req.param("id");
    const actor = requireRequestAuthentikUser(context);
    requireThreadCapability(deps, context, threadId, "manage");
    const token = randomBytes(32).toString("base64url");
    const invite = createThreadInvite(deps.db, {
      createdByUserId: actor.id,
      email: payload.email?.trim().toLowerCase() ?? null,
      expiresAt: Date.now() + payload.expiresInHours * 60 * 60 * 1000,
      role: payload.role,
      threadId,
      tokenHash: tokenHash(token),
    });
    const origin =
      process.env.BB_PUBLIC_ORIGIN ??
      deps.config.appUrl ??
      new URL(context.req.url).origin;
    return context.json(
      {
        invite: {
          ...invite,
          acceptedAt: null,
          acceptedByUserId: null,
          revokedAt: null,
        },
        url: `${origin.replace(/\/+$/u, "")}/invite/${token}`,
      },
      201,
    );
  });

  del(routes.revokeInvite, (context) => {
    const threadId = context.req.param("id");
    requireThreadCapability(deps, context, threadId, "manage");
    if (
      !revokeThreadInvite(deps.db, {
        id: context.req.param("inviteId"),
        threadId,
      })
    ) {
      throw new ApiError(404, "invite_not_found", "Thread invite not found");
    }
    return context.json({ ok: true as const });
  });

  get(routes.previewInvite, (context) => {
    const invite = getActiveThreadInviteByTokenHash(
      deps.db,
      tokenHash(context.req.param("token")),
    );
    if (!invite)
      throw new ApiError(
        404,
        "invite_not_found",
        "Invite is invalid or expired",
      );
    return context.json({
      email: invite.email,
      expiresAt: invite.expiresAt,
      role: invite.role,
      threadId: invite.threadId,
    });
  });

  post(routes.acceptInvite, (context) => {
    const user = requireRequestAuthentikUser(context);
    const invite = getActiveThreadInviteByTokenHash(
      deps.db,
      tokenHash(context.req.param("token")),
    );
    if (!invite)
      throw new ApiError(
        404,
        "invite_not_found",
        "Invite is invalid or expired",
      );
    if (invite.email !== null && invite.email !== user.email.toLowerCase()) {
      throw new ApiError(
        403,
        "invite_email_mismatch",
        "This invite was issued to another account",
      );
    }
    if (!acceptThreadInvite(deps.db, { id: invite.id, userId: user.id })) {
      throw new ApiError(409, "invite_already_used", "Invite was already used");
    }
    upsertThreadParticipant(deps.db, {
      role: invite.role,
      threadId: invite.threadId,
      userId: user.id,
    });
    return context.json(requireParticipantRow(deps, invite.threadId, user.id));
  });
}
