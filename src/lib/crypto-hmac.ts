import { createHmac, timingSafeEqual } from "node:crypto";

/** Shared with agent — never fall back to the published default key. */
export function getAgentSigningSecret(override?: string): string {
  const configured =
    override?.trim() ||
    process.env.AGENT_API_KEY?.trim() ||
    "";
  if (!configured || configured === "naviyra-local-agent-key") {
    throw new Error(
      "AGENT_API_KEY is missing or uses a known insecure default"
    );
  }
  if (configured.length < 16) {
    throw new Error("AGENT_API_KEY must be at least 16 characters");
  }
  return configured;
}

export function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function hmacSign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function hmacVerify(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = fromB64url(signature);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
