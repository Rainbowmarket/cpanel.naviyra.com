import fs from "node:fs";
import path from "node:path";
import { shouldUseSecureCookies } from "@/lib/cookie-secure";

/** Strip scheme/path/www → apex hostname. */
export function normalizeApexDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0] ?? value;
  value = value.split(":")[0] ?? value;
  value = value.replace(/^www\./, "");
  return value;
}

/**
 * DNS / marketing zone apex from a hostname.
 * `hpanel.naviyra.uk` → `naviyra.uk`; `naviyra.uk` stays `naviyra.uk`.
 */
export function zoneApexFromHostname(host: string): string {
  const h = normalizeApexDomain(host);
  const parts = h.split(".").filter(Boolean);
  if (parts.length >= 3) return parts.slice(1).join(".");
  return h;
}

/** Docs/examples copied into .env — never treat these as a live hostname. */
export function isDocsExampleHostname(host: string): boolean {
  const h = normalizeApexDomain(host);
  if (!h) return true;
  return (
    h.includes("yourdomain.com") ||
    h.includes("example.com") ||
    h.includes("example.org") ||
    h === "localhost"
  );
}

function hostnameFromPanelEnv(): string | null {
  const explicit = process.env.PANEL_HOSTNAME?.trim();
  if (explicit) {
    const host = normalizeApexDomain(explicit);
    if (host && !isDocsExampleHostname(host)) return host;
  }
  const publicUrl = process.env.PANEL_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      const host = normalizeApexDomain(new URL(publicUrl).hostname);
      if (host && !isDocsExampleHostname(host)) return host;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function apexFromInfraEnv(): string | null {
  const ns1 = process.env.DNS_NS1?.trim();
  if (ns1) {
    const apex = normalizeApexDomain(ns1).replace(/^ns\d+\./, "");
    if (apex.includes(".") && !isDocsExampleHostname(apex)) return apex;
  }
  const serverHost = process.env.DEFAULT_SERVER_HOSTNAME?.trim();
  if (serverHost) {
    const apex = normalizeApexDomain(serverHost).replace(/^(server\d+|s\d+)\./, "");
    if (apex.includes(".") && !isDocsExampleHostname(apex)) return apex;
  }
  return null;
}

/**
 * Control-panel hostname only (e.g. hpanel.naviyra.uk).
 * Sources: PANEL_HOSTNAME → PANEL_PUBLIC_URL → hpanel.{DNS apex}.
 * Docs examples like hpanel.yourdomain.com are ignored.
 * A 2-label PANEL_HOSTNAME is the marketing apex, not the panel vhost.
 */
export function getPanelHostname(): string | null {
  const apex = apexFromInfraEnv();
  const fromEnv = hostnameFromPanelEnv();
  if (fromEnv) {
    if (apex && fromEnv === apex) return `hpanel.${apex}`;
    const labels = fromEnv.split(".").filter(Boolean);
    if (labels.length === 2) return `hpanel.${fromEnv}`;
    return fromEnv;
  }
  if (apex) return `hpanel.${apex}`;
  return null;
}

/**
 * Nameserver / marketing zone apex (e.g. naviyra.uk).
 * Sources: DNS_NS1 → DEFAULT_SERVER_HOSTNAME → parent of panel hostname.
 */
export function getDnsZoneApex(): string | null {
  const infra = apexFromInfraEnv();
  if (infra) return infra;
  const panel = hostnameFromPanelEnv();
  if (panel) return zoneApexFromHostname(panel);
  return null;
}

/**
 * Panel hostname (PANEL_HOSTNAME). Prefer getDnsZoneApex() for NS/marketing.
 */
export function getPanelBaseDomain(): string | null {
  return getPanelHostname();
}

export function requirePanelBaseDomain(): string {
  const domain = getPanelBaseDomain();
  if (!domain) {
    throw new Error(
      "PANEL_HOSTNAME (or PANEL_PUBLIC_URL) is not set. " +
        "Set it in .env (npx installer) or complete admin first-login with your main domain."
    );
  }
  return domain;
}

/** Idempotently set KEY=value lines in the project .env (and process.env). */
export function upsertEnvKeys(updates: Record<string, string>): void {
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }

  const envPath = path.join(process.cwd(), ".env");
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {
    text = "";
  }

  const lines = text ? text.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#") || !line.includes("=")) {
      out.push(line);
      continue;
    }
    const key = line.split("=", 1)[0]!.trim();
    if (seen.has(key)) continue;
    if (key in updates) {
      out.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      out.push(line);
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }

  const next = out.join("\n").replace(/\n*$/, "\n");
  fs.writeFileSync(envPath, next, "utf8");
}

/** Persist panel hostname + derived DNS keys after admin first login. */
export function persistPanelBaseDomainFromLogin(domainInput: string): string {
  const domain = normalizeApexDomain(domainInput);
  const apex = zoneApexFromHostname(domain);
  const panelHost =
    domain.split(".").filter(Boolean).length >= 3 ? domain : `hpanel.${apex}`;
  const panelPort = process.env.PANEL_PORT?.trim() || "3100";
  const useHttps = shouldUseSecureCookies() || /^https:\/\//i.test(
    process.env.PANEL_PUBLIC_URL?.trim() || ""
  );
  const cleanPublicUrl = useHttps
    ? `https://${panelHost}`
    : `http://${panelHost}:${panelPort}`;

  const existingServerHost = process.env.DEFAULT_SERVER_HOSTNAME?.trim();
  upsertEnvKeys({
    PANEL_HOSTNAME: panelHost,
    PANEL_PUBLIC_URL: cleanPublicUrl,
    DNS_NS1: process.env.DNS_NS1?.trim() || `ns1.${apex}`,
    DNS_NS2: process.env.DNS_NS2?.trim() || `ns2.${apex}`,
    DEFAULT_SERVER_HOSTNAME: existingServerHost || `s1.${apex}`,
    LETSENCRYPT_EMAIL: process.env.LETSENCRYPT_EMAIL?.trim() || `admin@${apex}`,
    NEXT_PUBLIC_TERMINAL_WS_URL: `wss://${panelHost}/terminal-ws/terminal`,
  });

  return panelHost;
}
