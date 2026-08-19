import fs from "node:fs/promises";
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

export function hostnameRequirementMessage(label = "Domain"): string {
  return `${label} must include an extension like .com, .uk, or .in (e.g. example.com)`;
}

export function assertValidHostname(hostname: string, label = "Hostname"): string {
  const normalized = normalizeHostnameInput(hostname);
  if (!normalized.includes(".")) {
    throw new Error(hostnameRequirementMessage(label));
  }
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

export function isPathInsideBase(resolved: string, base: string): boolean {
  const root = path.resolve(base);
  const target = path.resolve(resolved);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(prefix);
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

  if (!isPathInsideBase(resolved, base)) {
    throw new Error(`Document root must resolve under ${base}`);
  }
  return resolved;
}

/**
 * Agent trust-boundary check: path must stay under the sites allowlist
 * after resolving symlinks (or after resolving the parent if the file is new).
 */
export async function assertSafeManagedPath(input: string): Promise<string> {
  const resolved = assertSafeDocumentRoot(input);
  const base = getDocumentRootAllowlistBase();
  try {
    const real = await fs.realpath(resolved);
    if (!isPathInsideBase(real, base)) {
      throw new Error(`Path must resolve under ${base} (symlink escape blocked)`);
    }
    return real;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") {
      if (error instanceof Error && /symlink escape|must resolve/.test(error.message)) {
        throw error;
      }
      throw error;
    }
  }
  try {
    const realParent = await fs.realpath(path.dirname(resolved));
    if (!isPathInsideBase(realParent, base)) {
      throw new Error(`Path must resolve under ${base} (symlink escape blocked)`);
    }
    return path.join(realParent, path.basename(resolved));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") return resolved;
    throw error;
  }
}

/** Require a file path to stay under an optional tenant document root as well. */
export async function assertPathUnderTenantRoot(
  filePath: string,
  tenantRoot?: string
): Promise<string> {
  const safe = await assertSafeManagedPath(filePath);
  const rootRaw = String(tenantRoot ?? "").trim();
  if (!rootRaw) return safe;
  const root = await assertSafeManagedPath(rootRaw);
  if (!isPathInsideBase(safe, root)) {
    throw new Error("Path outside tenant document root");
  }
  return safe;
}
