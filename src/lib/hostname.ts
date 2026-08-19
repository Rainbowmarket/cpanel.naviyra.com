import fs from "node:fs/promises";
import path from "node:path";

/**
 * RFC-1035-ish hostname / FQDN:
 * - one or more DNS labels separated by dots
 * - each label: 1–63 chars, [a-z0-9], hyphens not at ends
 * - total length ≤ 253
 * - rejects underscores, spaces, path chars, trailing dots, empty labels
 */
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

/** Full hostname / domain (at least two labels), e.g. example.com or api.example.com */
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

/**
 * Safe segment for path.join / nginx site names / cert dirs.
 * Same allowlist as hostname validation — never pass raw user input into paths.
 */
export function sanitizeHostnameForPath(hostname: string): string {
  return assertValidHostname(hostname, "Hostname");
}

/** Multi-label subdomain left-hand side (e.g. blog or api.v1) under a parent domain. */
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

/** Absolute directory that must resolve under the sites allowlist base. */
export function getDocumentRootAllowlistBase(cwd = process.cwd()): string {
  if (process.platform === "win32") {
    return path.resolve(cwd, "sites");
  }
  return path.resolve("/var/www");
}

/**
 * Resolve and require the path to live under the allowlisted sites root.
 * Never treat "starts with /" as sufficient.
 */
export function assertSafeDocumentRoot(
  input: string,
  opts?: { cwd?: string; allowlistBase?: string }
): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("Document root is required");
  }
  if (/[\0\r\n]/.test(raw)) {
    throw new Error("Document root contains invalid characters");
  }

  const base = path.resolve(
    /* turbopackIgnore: true */ opts?.allowlistBase ??
      getDocumentRootAllowlistBase(opts?.cwd)
  );
  const resolved = path.resolve(/* turbopackIgnore: true */ raw);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;

  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new Error(
      `Document root must resolve under ${base.replace(/\\/g, "/")}`
    );
  }
  return resolved;
}

export function isPathInsideBase(resolved: string, base: string): boolean {
  const root = path.resolve(base);
  const target = path.resolve(resolved);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(rootPrefix);
}

export async function assertSafeManagedPath(
  input: string,
  opts?: { cwd?: string; allowlistBase?: string }
): Promise<string> {
  const resolved = assertSafeDocumentRoot(input, opts);
  const base = path.resolve(
    opts?.allowlistBase ?? getDocumentRootAllowlistBase(opts?.cwd)
  );
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

export async function assertPathUnderTenantRoot(
  filePath: string,
  tenantRoot?: string,
  opts?: { cwd?: string; allowlistBase?: string }
): Promise<string> {
  const safe = await assertSafeManagedPath(filePath, opts);
  const rootRaw = String(tenantRoot ?? "").trim();
  if (!rootRaw) return safe;
  const root = await assertSafeManagedPath(rootRaw, opts);
  if (!isPathInsideBase(safe, root)) {
    throw new Error("Path outside tenant document root");
  }
  return safe;
}

export function defaultDomainDocumentRoot(
  domain: string,
  opts?: { cwd?: string; sitesRoot?: string }
): string {
  const safe = sanitizeHostnameForPath(domain);
  if (process.platform === "win32") {
    const root = opts?.sitesRoot
      ? path.resolve(opts.sitesRoot)
      : path.resolve(opts?.cwd ?? process.cwd(), "sites");
    return assertSafeDocumentRoot(path.join(root, safe, "public_html"), {
      allowlistBase: root,
      cwd: opts?.cwd,
    });
  }
  return assertSafeDocumentRoot(`/var/www/${safe}/public_html`);
}

export function defaultSubdomainDocumentRoot(
  domain: string,
  subdomain: string,
  opts?: { cwd?: string; sitesRoot?: string }
): string {
  const safeDomain = sanitizeHostnameForPath(domain);
  const safeSub = assertValidSubdomainLabels(subdomain);
  if (process.platform === "win32") {
    const root = opts?.sitesRoot
      ? path.resolve(opts.sitesRoot)
      : path.resolve(opts?.cwd ?? process.cwd(), "sites");
    return assertSafeDocumentRoot(
      path.join(root, safeDomain, "subdomains", safeSub, "public_html"),
      { allowlistBase: root, cwd: opts?.cwd }
    );
  }
  return assertSafeDocumentRoot(
    `/var/www/${safeDomain}/subdomains/${safeSub}/public_html`
  );
}
