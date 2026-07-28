import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.join(AGENT_DIR, "..");
export const SITES_ROOT = path.join(PROJECT_ROOT, "sites");
export const CONFIG_ROOT = path.join(PROJECT_ROOT, "data", "agent-config");
export const DNS_ROOT = path.join(PROJECT_ROOT, "data", "dns");

const API_KEY = process.env.AGENT_API_KEY ?? "naviyra-local-agent-key";
export { API_KEY };

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

export function getBindReloadCmd(): string | undefined {
  return process.env.BIND_RELOAD_CMD || "rndc reload";
}

/** Normalize document root for the current OS. */
export function resolveDocumentRoot(documentRoot: string, domain: string): string {
  if (process.platform === "win32") {
    return path.join(SITES_ROOT, domain, "public_html");
  }
  if (documentRoot.startsWith("/")) return documentRoot;
  return `/var/www/${domain}/public_html`;
}

export function resolveSubdomainRoot(
  documentRoot: string,
  domain: string,
  subdomain: string
): string {
  if (process.platform === "win32") {
    return path.join(SITES_ROOT, domain, "subdomains", subdomain, "public_html");
  }
  if (documentRoot.startsWith("/")) return documentRoot;
  return `/var/www/${domain}/subdomains/${subdomain}/public_html`;
}

/** Document root for SSL issuance when hostname may be apex or subdomain FQDN. */
export function resolveSslDocumentRoot(
  hostname: string,
  documentRoot?: string
): string {
  if (documentRoot?.startsWith("/")) return documentRoot;
  if (process.platform === "win32") {
    return path.join(SITES_ROOT, hostname, "public_html");
  }

  const parts = hostname.split(".");
  if (parts.length > 2) {
    const subdomain = parts[0];
    const apex = parts.slice(1).join(".");
    return `/var/www/${apex}/subdomains/${subdomain}/public_html`;
  }
  return `/var/www/${hostname}/public_html`;
}
