import path from "node:path";

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
  return process.env.DNS_NS1 ?? "ns1.naviyra.com";
}

export function getDnsNs2(): string {
  return process.env.DNS_NS2 ?? "ns2.naviyra.com";
}

export function getBindZonesDir(): string | undefined {
  return process.env.BIND_ZONES_DIR || undefined;
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
