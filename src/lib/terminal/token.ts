import { createHmac, timingSafeEqual } from "node:crypto";
import { requireAgentApiKey } from "@/lib/secrets";

export type TerminalTokenClaims = {
  sid: string;
  uid: string;
  /** "jail" = start in cwd with HOME set there — not OS containment. */
  mode: "full" | "jail";
  cwd: string;
  exp: number;
};

function getSecret(secret?: string): string {
  if (secret?.trim()) return secret.trim();
  return requireAgentApiKey();
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function signTerminalToken(
  claims: TerminalTokenClaims,
  secret?: string
): string {
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", getSecret(secret))
    .update(payload)
    .digest();
  return `${payload}.${b64url(sig)}`;
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
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
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

export function buildTerminalWsUrl(): string {
  if (process.env.NEXT_PUBLIC_TERMINAL_WS_URL) {
    return process.env.NEXT_PUBLIC_TERMINAL_WS_URL.replace(/\/$/, "");
  }
  const fallbackPort = process.platform === "linux" ? "4100" : "4000";
  const agentUrl = process.env.AGENT_URL ?? `http://127.0.0.1:${fallbackPort}`;
  try {
    const u = new URL(agentUrl);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/terminal";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return `ws://127.0.0.1:${fallbackPort}/terminal`;
  }
}
