/**
 * Terminal token HMAC — keep in sync with src/lib/terminal/token.ts
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type TerminalTokenClaims = {
  sid: string;
  uid: string;
  mode: "full" | "jail";
  cwd: string;
  exp: number;
};

function getSecret(secret?: string): string {
  return secret || process.env.AGENT_API_KEY || "naviyra-local-agent-key";
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
