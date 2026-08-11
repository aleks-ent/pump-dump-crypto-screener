import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  assertSafeReviewExposure,
  authorizeReviewRoute,
  isLoopbackHost,
  isProtectedReviewPath,
  resolveReviewAuthConfig,
  type ReviewAuthConfig,
} from "./review-auth.js";

interface AuthResult {
  allowed: boolean;
  status?: number;
  headers?: Record<string, string | number>;
  body?: string;
}

function authorize(
  auth: ReviewAuthConfig,
  path: string,
  options: { method?: string; authorization?: string } = {},
): AuthResult {
  const result: AuthResult = { allowed: false };
  const headers: IncomingHttpHeaders = {};
  if (options.authorization != null) headers.authorization = options.authorization;
  const req = {
    url: path,
    method: options.method ?? "GET",
    headers,
  } as IncomingMessage;
  const res = {
    writeHead(status: number, responseHeaders: Record<string, string | number>) {
      result.status = status;
      result.headers = responseHeaders;
      return this;
    },
    end(body?: string) {
      result.body = body;
      return this;
    },
  } as unknown as ServerResponse;
  result.allowed = authorizeReviewRoute(req, res, auth);
  return result;
}

describe("review authentication config", () => {
  it("is disabled by default and supports config credentials", () => {
    expect(resolveReviewAuthConfig({}, {})).toEqual({
      enabled: false,
      realm: "Pump Event Review",
    });
    expect(
      resolveReviewAuthConfig(
        { username: "reviewer", password: "config-secret", realm: "Internal review" },
        {},
      ),
    ).toEqual({
      enabled: true,
      username: "reviewer",
      password: "config-secret",
      realm: "Internal review",
    });
  });

  it("lets environment credentials override config without trimming secrets", () => {
    expect(
      resolveReviewAuthConfig(
        { username: "config-user", password: "config-password" },
        {
          PUMP_REVIEW_AUTH_USERNAME: "env-user",
          PUMP_REVIEW_AUTH_PASSWORD: " secret with spaces ",
          PUMP_REVIEW_AUTH_REALM: "Operations",
        },
      ),
    ).toMatchObject({
      enabled: true,
      username: "env-user",
      password: " secret with spaces ",
      realm: "Operations",
    });
  });

  it("rejects partial or malformed configuration", () => {
    expect(() =>
      resolveReviewAuthConfig({}, { PUMP_REVIEW_AUTH_USERNAME: "reviewer" }),
    ).toThrow("requires both");
    expect(() =>
      resolveReviewAuthConfig({ username: "bad:user", password: "secret" }, {}),
    ).toThrow("cannot contain a colon");
    expect(() => resolveReviewAuthConfig({ realm: "bad\nrealm" }, {})).toThrow(
      "printable ASCII",
    );
  });

  it("allows unauthenticated loopback only", () => {
    const disabled = resolveReviewAuthConfig({}, {});
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(() => assertSafeReviewExposure("127.0.0.1", disabled)).not.toThrow();
    expect(() => assertSafeReviewExposure("0.0.0.0", disabled)).toThrow(
      "Refusing to expose",
    );
    expect(() =>
      assertSafeReviewExposure(
        "0.0.0.0",
        resolveReviewAuthConfig({ username: "reviewer", password: "secret" }, {}),
      ),
    ).not.toThrow();
  });
});

describe("review route authentication", () => {
  const auth = resolveReviewAuthConfig(
    { username: "álëx", password: "different-length:secret", realm: 'Pump "QA"' },
    {},
  );

  it("protects the review page and review API without covering unrelated routes", () => {
    expect(isProtectedReviewPath("/review")).toBe(true);
    expect(isProtectedReviewPath("/api/pump-events/stats")).toBe(true);
    expect(isProtectedReviewPath("/api/market-data/candles")).toBe(true);
    expect(isProtectedReviewPath("/api/pump-events-malicious")).toBe(false);
    expect(isProtectedReviewPath("/healthz")).toBe(false);
  });

  it("challenges missing credentials with a safe, non-cacheable response", () => {
    const response = authorize(auth, "/review");
    expect(response.allowed).toBe(false);
    expect(response.status).toBe(401);
    expect(response.headers?.["www-authenticate"]).toBe(
      'Basic realm="Pump \\"QA\\"", charset="UTF-8"',
    );
    expect(response.headers?.["cache-control"]).toBe("no-store");
    expect(response.body).toBe("Authentication required\n");
  });

  it("accepts UTF-8 credentials and passwords containing colons", () => {
    const credentials = Buffer.from("álëx:different-length:secret", "utf8").toString(
      "base64",
    );
    const response = authorize(auth, "/api/pump-events/stats", {
      authorization: `Basic ${credentials}`,
    });
    expect(response).toEqual({ allowed: true });
  });

  it("rejects wrong and malformed credentials without affecting public health checks", () => {
    for (const authorization of [
      `Basic ${Buffer.from("álëx:wrong", "utf8").toString("base64")}`,
      `Basic ${Buffer.from("wrong:different-length:secret", "utf8").toString("base64")}`,
      "Basic !!!not-base64!!!",
      "Bearer token",
    ]) {
      expect(authorize(auth, "/api/market-data/candles", { authorization }).status).toBe(
        401,
      );
    }
    expect(authorize(auth, "/healthz")).toEqual({ allowed: true });
  });

  it("allows review routes when authentication is not configured", () => {
    const response = authorize(resolveReviewAuthConfig({}, {}), "/review");
    expect(response).toEqual({ allowed: true });
  });

  it("does not send a response body for HEAD challenges", () => {
    const response = authorize(auth, "/review", { method: "HEAD" });
    expect(response.status).toBe(401);
    expect(response.body).toBeUndefined();
  });
});
