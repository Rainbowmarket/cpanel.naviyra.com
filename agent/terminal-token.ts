/**
 * Terminal token HMAC — keep in sync with src/lib/terminal/token.ts
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TerminalTokenClaims = {
  sid: string;
  uid: string;
  mode: "full" | "jail";
  cwd: string;
  exp: number;
};

const PROJECT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function resolveAgentKey(): string {
  const configured = process.env.AGENT_API_KEY?.trim() || "";
  const weak =
    !configured ||
    configured.length < 16 ||
    configured === "naviyra-local-agent-key" ||
    configured === "change-me";

  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.AGENT_DRY_RUN === "false" ||
    process.env.COOKIE_SECURE === "true";

  if (!weak) return configured;

  if (isProd) {
    throw new Error(
      "AGENT_API_KEY must be a strong secret in production (not naviyra-local-agent-key)"
    );
  }

  const seed = `${PROJECT_ROOT}|${process.env.USER ?? process.env.USERNAME ?? "dev"}`;
  return `dev-${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
}

function getSecret(secret?: string): string {
  if (secret?.trim()) return secret.trim();
  return resolveAgentKey();
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function verifyTerminalToken(
  token: string,
  secret?: string
): TerminalTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid terminal token");
  }
  const [payload, sig] = parts;
  const expected = createHmac("sha256", getSecret(secret))
    .update(payload)
    .digest();
  const actual = fromB64url(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid terminal token signature");
  }
  const claims = JSON.parse(
    fromB64url(payload).toString("utf8")
  ) as TerminalTokenClaims;
  if (!claims.sid || !claims.uid || !claims.cwd || !claims.mode || !claims.exp) {
    throw new Error("Invalid terminal token claims");
  }
  if (Date.now() / 1000 > claims.exp) {
    throw new Error("Terminal token expired");
  }
  if (claims.mode !== "full" && claims.mode !== "jail") {
    throw new Error("Invalid terminal mode");
  }
  return claims;
}
