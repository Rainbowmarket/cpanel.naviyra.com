import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

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

  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.AGENT_DRY_RUN === "false" ||
    process.env.COOKIE_SECURE === "true";

  if (!weak) return configured;

  if (isProd) {
    throw new Error(
      "AGENT_API_KEY must be a strong secret in production (not naviyra-local-agent-key)"
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
