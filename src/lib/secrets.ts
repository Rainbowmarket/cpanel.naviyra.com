import { createHash, randomBytes } from "node:crypto";

/** Known insecure defaults that must never be used in production. */
export const WEAK_AGENT_KEYS = new Set([
  "naviyra-local-agent-key",
  "change-me",
  "secret",
  "password",
]);

export function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.AGENT_DRY_RUN === "false") return true;
  return false;
}

function looksWeak(value: string): boolean {
  const v = value.trim();
  if (v.length < 16) return true;
  if (WEAK_AGENT_KEYS.has(v)) return true;
  if (/^naviyra-local/i.test(v)) return true;
  return false;
}

/**
 * Resolve AGENT_API_KEY. Production refuses missing/weak values.
 * Local dry-run may use a machine-local derived key (not the published default).
 */
export function requireAgentApiKey(): string {
  const configured = process.env.AGENT_API_KEY?.trim();
  if (configured && !looksWeak(configured)) {
    return configured;
  }

  if (isProductionRuntime()) {
    throw new Error(
      "AGENT_API_KEY must be set to a strong secret (16+ chars) in production. " +
        "Do not use naviyra-local-agent-key."
    );
  }

  if (configured && looksWeak(configured)) {
    console.warn(
      "[security] AGENT_API_KEY is a known weak default — set a unique secret before production."
    );
  }

  // Dev-only: derive a host-local key so the published string is never required
  const seed = `${process.cwd()}|${process.env.USER ?? process.env.USERNAME ?? "dev"}`;
  return `dev-${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
}

/**
 * SESSION_SECRET for signed cookies. Production requires an explicit strong value.
 */
export function requireSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && !looksWeak(configured) && configured.length >= 24) {
    return configured;
  }

  if (isProductionRuntime()) {
    throw new Error(
      "SESSION_SECRET must be set to a strong random value (24+ chars) in production."
    );
  }

  const seed = `session|${process.cwd()}|${process.env.USER ?? process.env.USERNAME ?? "dev"}`;
  return createHash("sha256").update(seed).digest("hex");
}

export function generateSecureSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Prefer SECURITY_INGEST_KEY; else AGENT_API_KEY (never weak published default). */
export function requireIngestKey(): string {
  const ingest = process.env.SECURITY_INGEST_KEY?.trim();
  if (ingest && !looksWeak(ingest)) return ingest;
  return requireAgentApiKey();
}
