import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_REALM = "Pump Event Review";

export const REVIEW_AUTH_ENV = {
  username: "PUMP_REVIEW_AUTH_USERNAME",
  password: "PUMP_REVIEW_AUTH_PASSWORD",
  realm: "PUMP_REVIEW_AUTH_REALM",
} as const;

export interface ReviewAuthConfigInput {
  username?: string;
  password?: string;
  realm?: string;
}

export type ReviewAuthConfig =
  | {
      enabled: false;
      realm: string;
    }
  | {
      enabled: true;
      realm: string;
      username: string;
      password: string;
    };

function configuredValue(value: string | undefined): string | undefined {
  return value == null || value.length === 0 ? undefined : value;
}

function validateRealm(value: string | undefined): string {
  const realm = value?.trim() || DEFAULT_REALM;
  if (/[^\x20-\x7e]/.test(realm)) {
    throw new Error("Review authentication realm must contain printable ASCII characters only");
  }
  return realm;
}

/**
 * Resolve optional review credentials. Environment variables override config.js values,
 * which lets operators provision secrets without checking them into the repository.
 */
export function resolveReviewAuthConfig(
  config: ReviewAuthConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): ReviewAuthConfig {
  const username = configuredValue(env[REVIEW_AUTH_ENV.username] ?? config.username);
  const password = configuredValue(env[REVIEW_AUTH_ENV.password] ?? config.password);
  const realm = validateRealm(env[REVIEW_AUTH_ENV.realm] ?? config.realm);

  if ((username == null) !== (password == null)) {
    throw new Error(
      `Review authentication requires both ${REVIEW_AUTH_ENV.username} and ${REVIEW_AUTH_ENV.password} (or both corresponding config values)`,
    );
  }
  if (username == null || password == null) return { enabled: false, realm };
  if (username.includes(":")) {
    throw new Error("Review authentication username cannot contain a colon");
  }
  return { enabled: true, realm, username, password };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "::ffff:127.0.0.1"
  );
}

/** Fail closed when an unauthenticated review workspace would bind beyond loopback. */
export function assertSafeReviewExposure(host: string, auth: ReviewAuthConfig): void {
  if (!auth.enabled && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to expose the unauthenticated pump review workspace on ${host}; configure review Basic auth or bind web.host to 127.0.0.1`,
    );
  }
}

export function isProtectedReviewPath(pathname: string): boolean {
  return (
    pathname === "/review" ||
    pathname.startsWith("/review/") ||
    pathname === "/api/pump-events" ||
    pathname.startsWith("/api/pump-events/") ||
    pathname === "/api/market-data/candles" ||
    pathname.startsWith("/api/market-data/candles/")
  );
}

function constantTimeEqual(actual: string, expected: string): boolean {
  // Fixed-size digests let timingSafeEqual run even when credential lengths differ.
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function decodeBasicCredentials(header: string | undefined): {
  username: string;
  password: string;
} | null {
  if (header == null) return null;
  const match = /^Basic[ \t]+([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (match == null) return null;

  const encoded = match[1]!;
  const decodedBytes = Buffer.from(encoded, "base64");
  const canonical = decodedBytes.toString("base64").replace(/=+$/, "");
  if (canonical !== encoded.replace(/=+$/, "")) return null;

  const decoded = decodedBytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(decodedBytes)) return null;
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

export function isReviewRequestAuthorized(
  req: IncomingMessage,
  auth: ReviewAuthConfig,
): boolean {
  if (!auth.enabled) return true;
  const credentials = decodeBasicCredentials(req.headers.authorization);
  if (credentials == null) return false;

  // Always compare both fields so a valid username does not create a timing shortcut.
  const usernameMatches = constantTimeEqual(credentials.username, auth.username);
  const passwordMatches = constantTimeEqual(credentials.password, auth.password);
  return usernameMatches && passwordMatches;
}

function challengeRealm(realm: string): string {
  return realm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sendReviewAuthChallenge(
  res: ServerResponse,
  realm: string = DEFAULT_REALM,
  headOnly = false,
): void {
  const body = "Authentication required\n";
  res.writeHead(401, {
    "www-authenticate": `Basic realm="${challengeRealm(validateRealm(realm))}", charset="UTF-8"`,
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

/**
 * Authenticate only review UI/API routes. Returns true when routing may continue;
 * otherwise sends the Basic challenge and returns false.
 */
export function authorizeReviewRoute(
  req: IncomingMessage,
  res: ServerResponse,
  auth: ReviewAuthConfig,
): boolean {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!isProtectedReviewPath(pathname) || isReviewRequestAuthorized(req, auth)) return true;
  sendReviewAuthChallenge(res, auth.realm, req.method === "HEAD");
  return false;
}
