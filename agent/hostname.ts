import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * RFC-1035-ish hostname validation (mirrored from panel src/lib/hostname.ts).
 * Applied before any path.join involving user-controlled hostnames.
 */
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(AGENT_DIR, "..");
const SITES_ROOT = path.join(PROJECT_ROOT, "sites");

export function normalizeHostnameInput(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0] ?? value;
  value = value.split(":")[0] ?? value;
  value = value.replace(/\.$/, "");
  value = value.replace(/^www\./, "");
  return value;
}

export function isValidDnsLabel(label: string): boolean {
  return Boolean(label) && label.length <= 63 && DNS_LABEL_RE.test(label);
}

export function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false;
  if (hostname.includes("..") || hostname.startsWith(".") || hostname.endsWith(".")) {
    return false;
  }
  if (!HOSTNAME_RE.test(hostname)) return false;
  return hostname.split(".").every(isValidDnsLabel);
}

export function assertValidHostname(hostname: string, label = "Hostname"): string {
  const normalized = normalizeHostnameInput(hostname);
  if (!isValidHostname(normalized)) {
    throw new Error(
      `${label} must be a valid DNS name (e.g. example.com). Letters, numbers, hyphens only.`
    );
  }
  return normalized;
}

export function sanitizeHostnameForPath(hostname: string): string {
  return assertValidHostname(hostname, "Hostname");
}

export function assertValidSubdomainLabels(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 190) {
    throw new Error("Invalid subdomain name");
  }
  const parts = normalized.split(".");
  if (!parts.every(isValidDnsLabel)) {
    throw new Error(
      "Invalid subdomain. Use letters, numbers, hyphens (e.g. blog or api.v1)."
    );
  }
  return normalized;
}

export function getDocumentRootAllowlistBase(): string {
  if (process.platform === "win32") {
    return path.resolve(SITES_ROOT);
  }
  return path.resolve("/var/www");
}

export function assertSafeDocumentRoot(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("Document root is required");
  }
  if (/[\0\r\n]/.test(raw)) {
    throw new Error("Document root contains invalid characters");
  }

  const base = getDocumentRootAllowlistBase();
  const resolved = path.resolve(raw);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;

  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new Error(`Document root must resolve under ${base}`);
  }
  return resolved;
}
