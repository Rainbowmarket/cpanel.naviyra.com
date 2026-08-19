import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Known insecure defaults that must never be used in production. */
export const WEAK_AGENT_KEYS = new Set([
  "naviyra-local-agent-key",
  "change-me",
  "secret",
  "password",
]);

export function isProductionRuntime(): boolean {
  // Fail closed: derived/dev secrets only when NODE_ENV is explicitly development.
  // Unset NODE_ENV (misconfigured deploy) is treated as production.
  return process.env.NODE_ENV !== "development";
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
      "AGENT_API_KEY must be set to a strong secret (16+ chars) unless NODE_ENV=development. " +
        "Do not use naviyra-local-agent-key. Systemd must set NODE_ENV=production."
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

function parseEncKeyMaterial(raw: string): Buffer | null {
  const v = raw.trim();
  if (!v) return null;
  // 64 hex chars → 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(v)) {
    return Buffer.from(v, "hex");
  }
  // base64 → 32 bytes
  try {
    const buf = Buffer.from(v, "base64");
    if (buf.length === 32) return buf;
  } catch {
    /* fall through */
  }
  // Derive a stable 32-byte key from a long passphrase (dev convenience only)
  if (v.length >= 32) {
    return createHash("sha256").update(v).digest();
  }
  return null;
}

/**
 * AES-256 key for encrypting TOTP secrets at rest.
 * Production requires TWO_FACTOR_ENC_KEY (openssl rand -hex 32).
 */
export function requireTwoFactorEncKey(): Buffer {
  const configured = process.env.TWO_FACTOR_ENC_KEY?.trim();
  if (configured) {
    const key = parseEncKeyMaterial(configured);
    if (key) return key;
  }

  if (isProductionRuntime()) {
    throw new Error(
      "TWO_FACTOR_ENC_KEY must be set to a 32-byte key in production " +
        "(openssl rand -hex 32)."
    );
  }

  const seed = `2fa-enc|${process.cwd()}|${process.env.USER ?? process.env.USERNAME ?? "dev"}`;
  return createHash("sha256").update(seed).digest();
}

/** AES-256-GCM encrypt — returns base64url(iv || tag || ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = requireTwoFactorEncKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

/** Decrypt value produced by encryptSecret. */
export function decryptSecret(packed: string): string {
  const key = requireTwoFactorEncKey();
  const buf = Buffer.from(packed, "base64url");
  if (buf.length < 12 + 16 + 1) {
    throw new Error("Invalid encrypted secret");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
