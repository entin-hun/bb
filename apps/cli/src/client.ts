import { createNodeBbSdk, type BbSdk } from "@bb/sdk/node";
import type { Dispatcher } from "undici";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  const session = process.env.BB_AUTHENTIK_SESSION?.trim();
  if (!session) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("cookie", `bb_authentik_session=${encodeURIComponent(session)}`);
  return fetch(input, { ...init, headers });
}

export function createCliBbSdk(baseUrl: string): BbSdk {
  return createNodeBbSdk({ baseUrl, fetch: cliFetch });
}
