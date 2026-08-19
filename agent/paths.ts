import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  assertSafeDocumentRoot,
  assertValidSubdomainLabels,
  sanitizeHostnameForPath,
} from "./hostname";

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.join(AGENT_DIR, "..");
export const SITES_ROOT = path.join(PROJECT_ROOT, "sites");
export const CONFIG_ROOT = path.join(PROJECT_ROOT, "data", "agent-config");
export const DNS_ROOT = path.join(PROJECT_ROOT, "data", "dns");

function resolveApiKey(): string {
  const configured = process.env.AGENT_API_KEY?.trim() || "";
  const weak =
    !configured ||
    configured.length < 16 ||
    configured === "naviyra-local-agent-key" ||
    configured === "change-me";

  const allowDerived = process.env.NODE_ENV === "development";

  if (!weak) return configured;

  if (!allowDerived) {
    throw new Error(
      "AGENT_API_KEY must be a strong secret unless NODE_ENV=development (not naviyra-local-agent-key). " +
        "Set NODE_ENV=production in the systemd unit."
    );
  }

  const seed = `${PROJECT_ROOT}|${process.env.USER ?? process.env.USERNAME ?? "dev"}`;
  return `dev-${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
}

const API_KEY = resolveApiKey();
export { API_KEY };

/** Bind address — default loopback so the agent is not exposed on the LAN/internet. */
export function getAgentBindHost(): string {
  return process.env.AGENT_BIND_HOST?.trim() || "127.0.0.1";
}

export function getBindZonesDir(): string | undefined {
  return process.env.BIND_ZONES_DIR || undefined;
}

export function getBindNamedDir(): string | undefined {
  if (process.env.BIND_NAMED_DIR) return process.env.BIND_NAMED_DIR;
  const zonesDir = getBindZonesDir();
  if (!zonesDir) return undefined;
  return path.join(path.dirname(zonesDir), "naviyra-zones.d");
}

export function getBindIncludeFile(): string | undefined {
  if (process.env.BIND_INCLUDE_FILE) return process.env.BIND_INCLUDE_FILE;
  const zonesDir = getBindZonesDir();
  if (!zonesDir) return undefined;
  return path.join(path.dirname(zonesDir), "naviyra-zones.conf");
}

export function getBindReloadCmd(): string {
  return normalizeBindReloadCmd(process.env.BIND_RELOAD_CMD);
}

/** systemd EnvironmentFile drops args after spaces unless quoted — normalize. */
export function normalizeBindReloadCmd(raw: string | undefined | null): string {
  const value = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!value || value === "rndc") return "rndc reload";
  if (value === "systemctl") return "systemctl reload named";
  return value;
}

/**
 * Resolve domain document root. Ignores free-form client paths for apex domains;
 * always derives from sanitized hostname under the sites allowlist.
 */
export function resolveDocumentRoot(_documentRoot: string, domain: string): string {
  const safeDomain = sanitizeHostnameForPath(domain);
  if (process.platform === "win32") {
    return assertSafeDocumentRoot(
      path.join(SITES_ROOT, safeDomain, "public_html")
    );
  }
  return assertSafeDocumentRoot(`/var/www/${safeDomain}/public_html`);
}

/**
 * Resolve subdomain document root. Custom paths are allowed only if they
 * resolve under the sites allowlist (/var/www or local sites/).
 */
export function resolveSubdomainRoot(
  documentRoot: string,
  domain: string,
  subdomain: string
): string {
  const safeDomain = sanitizeHostnameForPath(domain);
  const safeSub = assertValidSubdomainLabels(subdomain);
  const fallback =
    process.platform === "win32"
      ? path.join(SITES_ROOT, safeDomain, "subdomains", safeSub, "public_html")
      : `/var/www/${safeDomain}/subdomains/${safeSub}/public_html`;

  if (!documentRoot?.trim()) {
    return assertSafeDocumentRoot(fallback);
  }
  return assertSafeDocumentRoot(documentRoot);
}

/** Document root for SSL issuance when hostname may be apex or subdomain FQDN. */
export function resolveSslDocumentRoot(
  hostname: string,
  documentRoot?: string
): string {
  const safeHost = sanitizeHostnameForPath(hostname);
  if (documentRoot?.trim()) {
    return assertSafeDocumentRoot(documentRoot);
  }
  if (process.platform === "win32") {
    return assertSafeDocumentRoot(
      path.join(SITES_ROOT, safeHost, "public_html")
    );
  }

  const parts = safeHost.split(".");
  if (parts.length > 2) {
    const subdomain = parts[0]!;
    const apex = parts.slice(1).join(".");
    return assertSafeDocumentRoot(
      `/var/www/${apex}/subdomains/${subdomain}/public_html`
    );
  }
  return assertSafeDocumentRoot(`/var/www/${safeHost}/public_html`);
}
