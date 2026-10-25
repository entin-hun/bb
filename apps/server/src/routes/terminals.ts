import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { getRequestAuthentikUser } from "../services/authentik.js";
import {
  requireThreadCapability,
  type ThreadCapability,
} from "../services/thread-access.js";

function requireUnscopedTerminalAccess(context: object): void {
  if (getRequestAuthentikUser(context) !== null) {
    throw new ApiError(
      403,
      "forbidden",
      "Authentik users can only access terminals attached to an authorized thread",
    );
  }
}

function requireTerminalCapability(
  deps: AppDeps,
  context: object,
  terminalId: string,
  capability: ThreadCapability,
) {
  const session = deps.terminalSessions.getTerminal({ terminalId });
  if (session.threadId === null) {
    requireUnscopedTerminalAccess(context);
  } else {
    requireThreadCapability(deps, context, session.threadId, capability);
  }
  return session;
}

export function registerTerminalRoutes(app: Hono, deps: AppDeps): void {
  const { get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.terminals;

  get(routes.list, (context, query) => {
    if (query.threadId !== undefined) {
      requireThreadCapability(deps, context, query.threadId, "read");
    } else {
      requireUnscopedTerminalAccess(context);
    }
    const sessions = deps.terminalSessions.listTerminals({ query });
    return context.json({ sessions });
  });

  post(routes.create, async (context, payload) => {
    if (payload.target.kind === "thread") {
      requireThreadCapability(deps, context, payload.target.threadId, "post");
    } else {
      requireUnscopedTerminalAccess(context);
    }
    const session = await deps.terminalSessions.createTerminal({ payload });
    return context.json(session, 201);
  });

  get(routes.get, (context) => {
    const session = requireTerminalCapability(
      deps,
      context,
      context.req.param("terminalId"),
      "read",
    );
    return context.json(session);
  });

  patch(routes.update, (context, payload) => {
    requireTerminalCapability(
      deps,
      context,
      context.req.param("terminalId"),
      "post",
    );
    const session = deps.terminalSessions.renameTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  post(routes.restart, async (context) => {
    requireTerminalCapability(
      deps,
      context,
      context.req.param("terminalId"),
      "post",
    );
    const session = await deps.terminalSessions.restartTerminal({
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session, 201);
  });

  post(routes.close, async (context, payload) => {
    requireTerminalCapability(
      deps,
      context,
      context.req.param("terminalId"),
      "post",
    );
    const session = await deps.terminalSessions.closeTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  post(routes.input, (context, payload) => {
    requireTerminalCapability(
      deps,
      context,
      context.req.param("terminalId"),
      "post",
    );
    const session = deps.terminalSessions.sendTerminalInput({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  post(routes.resize, (context, payload) => {
    requireTerminalCapability(
      deps,
      context,
      context.req.param("terminalId"),
      "post",
    );
    const session = deps.terminalSessions.resizeTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  get(routes.output, async (context, query) => {
    requireTerminalCapability(
      deps,
      context,
      context.req.param("terminalId"),
      "read",
    );
    const output = await deps.terminalSessions.readTerminalOutput({
      query,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(output);
  });
}
