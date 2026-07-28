import path from "node:path";
import { getPanelBaseDomain } from "@/lib/base-domain";

/** Cross-platform website root for a domain. */
export function getDefaultDocumentRoot(domain: string): string {
  if (process.platform === "win32") {
    return path.join(process.cwd(), "sites", domain, "public_html");
  }
  return `/var/www/${domain}/public_html`;
}

export function getDefaultSubdomainRoot(
  domain: string,
  subdomain: string
): string {
  if (process.platform === "win32") {
    return path.join(
      process.cwd(),
      "sites",
      domain,
      "subdomains",
      subdomain,
      "public_html"
    );
  }
  return `/var/www/${domain}/subdomains/${subdomain}/public_html`;
}

export function getAgentApiKey(): string {
  return process.env.AGENT_API_KEY ?? "naviyra-local-agent-key";
}

export function getDnsRoot(): string {
  return path.join(process.cwd(), "data", "dns");
}

export function getDnsNs1(): string {
  if (process.env.DNS_NS1?.trim()) return process.env.DNS_NS1.trim();
  const base = getPanelBaseDomain();
  return base ? `ns1.${base}` : "ns1.localhost";
}

export function getDnsNs2(): string {
  if (process.env.DNS_NS2?.trim()) return process.env.DNS_NS2.trim();
  const base = getPanelBaseDomain();
  return base ? `ns2.${base}` : "ns2.localhost";
}

export function getDefaultServerHostname(): string {
  if (process.env.DEFAULT_SERVER_HOSTNAME?.trim()) {
    return process.env.DEFAULT_SERVER_HOSTNAME.trim();
  }
  const base = getPanelBaseDomain();
  return base ? `server1.${base}` : "server1.localhost";
}

export function getLetsEncryptEmail(): string {
  if (process.env.LETSENCRYPT_EMAIL?.trim()) {
    return process.env.LETSENCRYPT_EMAIL.trim();
  }
  const base = getPanelBaseDomain();
  return base ? `admin@${base}` : "admin@localhost";
}

export function getBindZonesDir(): string | undefined {
  return process.env.BIND_ZONES_DIR || undefined;
}

/** Directory of per-domain named.conf snippets included by BIND. */
export function getBindNamedDir(): string | undefined {
  if (process.env.BIND_NAMED_DIR) return process.env.BIND_NAMED_DIR;
  const zonesDir = getBindZonesDir();
  if (!zonesDir) return undefined;
  return path.join(path.dirname(zonesDir), "naviyra-zones.d");
}

/** Master include file that lists every zone snippet (BIND has no glob include). */
export function getBindIncludeFile(): string | undefined {
  if (process.env.BIND_INCLUDE_FILE) return process.env.BIND_INCLUDE_FILE;
  const zonesDir = getBindZonesDir();
  if (!zonesDir) return undefined;
  return path.join(path.dirname(zonesDir), "naviyra-zones.conf");
}

export function getBindReloadCmd(): string {
  return process.env.BIND_RELOAD_CMD ?? "rndc reload";
}

/** Mail server hostname for DNS. Use `{domain}` for per-domain host (default `mail.{domain}`). */
export function getMailHostname(domainName: string): string {
  const template = process.env.MAIL_HOSTNAME ?? "mail.{domain}";
  return template.replace(/\{domain\}/g, domainName);
}

/** Public IPv4 used in DNS A records and SPF. Set in .env for production. */
export function getServerPublicIp(fallback = "127.0.0.1"): string {
  const configured = process.env.SERVER_PUBLIC_IP?.trim();
  return configured || fallback;
}
