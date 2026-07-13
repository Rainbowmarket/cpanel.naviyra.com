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

export function getBindReloadCmd(): string | undefined {
  return process.env.BIND_RELOAD_CMD || "rndc reload";
}

/** Normalize document root for the current OS. */
export function resolveDocumentRoot(documentRoot: string, domain: string): string {
  const isLinuxPath =
    documentRoot.startsWith("/var/www") || documentRoot.startsWith("/");

  if (process.platform === "win32" || (process.platform !== "linux" && isLinuxPath)) {
    return path.join(SITES_ROOT, domain, "public_html");
  }

  return documentRoot;
}

export function resolveSubdomainRoot(
  documentRoot: string,
  domain: string,
  subdomain: string
): string {
  if (
    process.platform === "win32" ||
    documentRoot.startsWith("/var/www") ||
    documentRoot.startsWith("/")
  ) {
    return path.join(SITES_ROOT, domain, "subdomains", subdomain, "public_html");
  }
  return documentRoot;
}
