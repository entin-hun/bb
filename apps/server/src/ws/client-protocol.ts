import { clientMessageSchema, type PongMessage } from "@bb/domain";
import { parseSocketMessage } from "./decode-payload.js";
import type { NotificationHub } from "./hub.js";

const PONG_MESSAGE: PongMessage = { type: "pong" };

interface ClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function onClientSocketOpen(
  hub: NotificationHub,
  socket: ClientSocket,
  canAccessThread: ((threadId: string) => boolean) | null = null,
): void {
  hub.registerClient(socket, canAccessThread);
}

export function onClientSocketMessage(
  hub: NotificationHub,
  socket: ClientSocket,
  raw: unknown,
): void {
  const parsed = parseSocketMessage(socket, raw, clientMessageSchema);
  if (parsed === null) {
    return;
  }

  switch (parsed.type) {
    case "subscribe":
      for (const target of parsed.targets ??
        (parsed.target ? [parsed.target] : [])) {
        if (
          (target.kind === "thread-detail" ||
            target.kind === "thread-timeline") &&
          !hub.clientCanAccessThread(socket, target.threadId)
        ) {
          socket.close(1008, "thread_forbidden");
          return;
        }
        hub.subscribe(socket, target);
      }
      break;
    case "unsubscribe":
      for (const target of parsed.targets ??
        (parsed.target ? [parsed.target] : [])) {
        hub.unsubscribe(socket, target);
      }
      break;
    case "ping":
      socket.send(JSON.stringify(PONG_MESSAGE));
      break;
    case "visibility":
      hub.setClientVisible(socket, parsed.visible);
      break;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unhandled client message: ${_exhaustive}`);
    }
  }
}

export function onClientSocketClose(
  hub: NotificationHub,
  socket: ClientSocket,
): void {
  hub.unregisterClient(socket);
}
