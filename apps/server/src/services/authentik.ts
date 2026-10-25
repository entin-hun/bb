import { createHash, randomBytes } from "node:crypto";
import {
  createUserSession,
  deleteUserSession,
  getActiveUserSession,
  upsertAuthentikUser,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "../errors.js";

const SESSION_COOKIE = "bb_authentik_session";
const OAUTH_STATE_COOKIE = "bb_authentik_state";
const OAUTH_VERIFIER_COOKIE = "bb_authentik_verifier";
const OAUTH_NONCE_COOKIE = "bb_authentik_nonce";
const OAUTH_RETURN_TO_COOKIE = "bb_authentik_return_to";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const AUTHENTIK_USER_CONTEXT_KEY = "bbAuthentikUser";

export interface AuthentikConfig {
  clientId: string;
  clientSecret: string;
  issuer: string;
  publicUrl: string;
}

interface OidcMetadata {
  authorization_endpoint: string;
  issuer: string;
  jwks_uri: string;
  token_endpoint: string;
}

export type AuthentikUser = NonNullable<
  ReturnType<typeof getActiveUserSession>
>["user"];

const requestUsers = new WeakMap<object, AuthentikUser | null>();

const metadataCache = new Map<string, Promise<OidcMetadata>>();

export function authentikConfigFromEnvironment(): AuthentikConfig | null {
  const issuer = process.env.BB_AUTHENTIK_ISSUER?.trim();
  const clientId = process.env.BB_AUTHENTIK_CLIENT_ID?.trim();
  const clientSecret = process.env.BB_AUTHENTIK_CLIENT_SECRET?.trim();
  const publicUrl = (
    process.env.BB_PUBLIC_ORIGIN ?? process.env.BB_APP_URL
  )?.trim();
  if (!issuer && !clientId && !clientSecret) return null;
  if (!issuer || !clientId || !clientSecret || !publicUrl) {
    throw new Error(
      "BB_AUTHENTIK_ISSUER, BB_AUTHENTIK_CLIENT_ID, BB_AUTHENTIK_CLIENT_SECRET, and BB_PUBLIC_ORIGIN (or BB_APP_URL) are required together",
    );
  }
  return {
    clientId,
    clientSecret,
    issuer: issuer.replace(/\/+$/u, ""),
    publicUrl: publicUrl.replace(/\/+$/u, ""),
  };
}

function cookie(
  config: AuthentikConfig,
  name: string,
  value: string,
  maxAge?: number,
): string {
  const secure =
    new URL(config.publicUrl).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;
}

function readCookie(header: string | undefined, name: string): string | null {
  const value = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (value === undefined) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function randomUrlToken(): string {
  return randomBytes(32).toString("base64url");
}

function challenge(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

async function oidcMetadata(config: AuthentikConfig): Promise<OidcMetadata> {
  let pending = metadataCache.get(config.issuer);
  if (pending === undefined) {
    pending = (async () => {
      const response = await fetch(
        `${config.issuer}/.well-known/openid-configuration`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        throw new ApiError(
          502,
          "oidc_discovery_failed",
          "Could not load Authentik configuration",
        );
      }
      const value = (await response.json()) as Partial<OidcMetadata>;
      if (
        typeof value.authorization_endpoint !== "string" ||
        typeof value.token_endpoint !== "string" ||
        typeof value.jwks_uri !== "string" ||
        typeof value.issuer !== "string"
      ) {
        throw new ApiError(
          502,
          "oidc_discovery_failed",
          "Authentik returned invalid OIDC configuration",
        );
      }
      return value as OidcMetadata;
    })();
    metadataCache.set(config.issuer, pending);
  }
  return pending;
}

export async function beginAuthentikLogin(
  config: AuthentikConfig,
  returnTo: string | undefined,
): Promise<Response> {
  const metadata = await oidcMetadata(config);
  const state = randomUrlToken();
  const verifier = randomUrlToken();
  const nonce = randomUrlToken();
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set(
    "redirect_uri",
    `${config.publicUrl}/auth/authentik/callback`,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return new Response(null, {
    status: 302,
    headers: [
      ["location", url.toString()],
      ["set-cookie", cookie(config, OAUTH_STATE_COOKIE, state, 600)],
      ["set-cookie", cookie(config, OAUTH_VERIFIER_COOKIE, verifier, 600)],
      ["set-cookie", cookie(config, OAUTH_NONCE_COOKIE, nonce, 600)],
      [
        "set-cookie",
        cookie(config, OAUTH_RETURN_TO_COOKIE, safeReturnTo(returnTo), 600),
      ],
    ],
  });
}

export async function completeAuthentikLogin(args: {
  code: string;
  config: AuthentikConfig;
  cookies: string | undefined;
  db: DbConnection;
  state: string | undefined;
}): Promise<Response> {
  const state = readCookie(args.cookies, OAUTH_STATE_COOKIE);
  const verifier = readCookie(args.cookies, OAUTH_VERIFIER_COOKIE);
  const nonce = readCookie(args.cookies, OAUTH_NONCE_COOKIE);
  const returnTo = safeReturnTo(
    readCookie(args.cookies, OAUTH_RETURN_TO_COOKIE) ?? undefined,
  );
  if (!state || !verifier || !nonce || state !== args.state) {
    throw new ApiError(400, "invalid_request", "Invalid Authentik login state");
  }
  const metadata = await oidcMetadata(args.config);
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.config.clientId,
      client_secret: args.config.clientSecret,
      code: args.code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: `${args.config.publicUrl}/auth/authentik/callback`,
    }),
  });
  if (!response.ok) {
    throw new ApiError(401, "unauthorized", "Authentik rejected the login");
  }
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new ApiError(
      401,
      "unauthorized",
      "Authentik did not return an ID token",
    );
  }
  const verified = await jwtVerify(
    tokens.id_token,
    createRemoteJWKSet(new URL(metadata.jwks_uri)),
    { audience: args.config.clientId, issuer: metadata.issuer },
  );
  if (verified.payload.nonce !== nonce) {
    throw new ApiError(
      401,
      "unauthorized",
      "Authentik returned an invalid nonce",
    );
  }
  const subject = verified.payload.sub;
  const email =
    typeof verified.payload.email === "string"
      ? verified.payload.email.trim().toLowerCase()
      : null;
  if (!subject || !email) {
    throw new ApiError(
      401,
      "unauthorized",
      "Authentik account is missing an email address",
    );
  }
  const name =
    typeof verified.payload.name === "string" ? verified.payload.name : email;
  const user = upsertAuthentikUser(args.db, {
    email,
    issuer: metadata.issuer,
    name,
    subject,
  });
  const session = createUserSession(args.db, {
    expiresAt: Date.now() + SESSION_TTL_MS,
    userId: user.id,
  });
  const cleared = [
    OAUTH_STATE_COOKIE,
    OAUTH_VERIFIER_COOKIE,
    OAUTH_NONCE_COOKIE,
    OAUTH_RETURN_TO_COOKIE,
  ];
  return new Response(null, {
    status: 302,
    headers: [
      ["location", returnTo],
      [
        "set-cookie",
        cookie(args.config, SESSION_COOKIE, session, SESSION_TTL_MS / 1000),
      ],
      ...cleared.map(
        (name) =>
          ["set-cookie", cookie(args.config, name, "", 0)] as [string, string],
      ),
    ],
  });
}

export function getAuthentikUser(
  db: DbConnection,
  cookieHeader: string | undefined,
): AuthentikUser | null {
  const id = readCookie(cookieHeader, SESSION_COOKIE);
  return id ? (getActiveUserSession(db, id)?.user ?? null) : null;
}

export function setRequestAuthentikUser(
  context: object,
  user: AuthentikUser | null,
): void {
  requestUsers.set(context, user);
}

export function getRequestAuthentikUser(context: object): AuthentikUser | null {
  return requestUsers.get(context) ?? null;
}

export function requireRequestAuthentikUser(context: object): AuthentikUser {
  const user = getRequestAuthentikUser(context);
  if (!user) {
    throw new ApiError(
      401,
      "unauthorized",
      "Sign in with Authentik to continue",
    );
  }
  return user;
}

export function logoutAuthentikUser(
  config: AuthentikConfig,
  db: DbConnection,
  cookieHeader: string | undefined,
): Response {
  const id = readCookie(cookieHeader, SESSION_COOKIE);
  if (id) deleteUserSession(db, id);
  return new Response(null, {
    status: 204,
    headers: [["set-cookie", cookie(config, SESSION_COOKIE, "", 0)]],
  });
}
