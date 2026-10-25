import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMigratedConnection } from "@bb/db/testing";
import {
  beginAuthentikLogin,
  completeAuthentikLogin,
  getAuthentikUser,
  type AuthentikConfig,
} from "./authentik.js";

function setCookies(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie();
}

function cookieHeader(response: Response): string {
  return setCookies(response)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Authentik OIDC", () => {
  it("uses authorization code PKCE and creates a server-side session", async () => {
    const issuer = "https://auth.example.test/application/o/bb-test";
    const config: AuthentikConfig = {
      clientId: "bb-client",
      clientSecret: "bb-secret",
      issuer,
      publicUrl: "https://bb.example.test",
    };
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const metadata = {
      authorization_endpoint: `${issuer}/authorize/`,
      issuer,
      jwks_uri: `${issuer}/jwks/`,
      token_endpoint: `${issuer}/token/`,
    };
    let nonce = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Response.json(metadata);
        }
        if (url === metadata.jwks_uri) {
          return Response.json({
            keys: [{ ...jwk, alg: "RS256", kid: "test-key", use: "sig" }],
          });
        }
        if (url === metadata.token_endpoint) {
          const idToken = await new SignJWT({
            email: "User@Example.Test",
            name: "Test User",
            nonce,
          })
            .setProtectedHeader({ alg: "RS256", kid: "test-key" })
            .setAudience(config.clientId)
            .setIssuer(issuer)
            .setSubject("authentik-user-1")
            .setExpirationTime("5m")
            .sign(privateKey);
          return Response.json({ id_token: idToken });
        }
        return new Response(null, { status: 404 });
      }),
    );

    const start = await beginAuthentikLogin(config, "/threads/shared");
    const location = new URL(start.headers.get("location") ?? "");
    nonce = location.searchParams.get("nonce") ?? "";
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://bb.example.test/auth/authentik/callback",
    );

    const db = createMigratedConnection();
    const completed = await completeAuthentikLogin({
      code: "authorization-code",
      config,
      cookies: cookieHeader(start),
      db,
      state: location.searchParams.get("state") ?? undefined,
    });
    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toBe("/threads/shared");
    const sessionCookie = setCookies(completed).find((value) =>
      value.startsWith("bb_authentik_session="),
    );
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(getAuthentikUser(db, sessionCookie?.split(";", 1)[0])).toMatchObject(
      {
        email: "user@example.test",
        name: "Test User",
      },
    );
  });
});
