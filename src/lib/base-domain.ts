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
 * Panel / nameserver base domain from .env (set at install or first admin login).
 * Sources (first match): PANEL_HOSTNAME → PANEL_PUBLIC_URL → DEFAULT_SERVER_HOSTNAME → DNS_NS1
 */
export function getPanelBaseDomain(): string | null {
  const explicit = process.env.PANEL_HOSTNAME?.trim();
  if (explicit) return normalizeApexDomain(explicit);

  const publicUrl = process.env.PANEL_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      return normalizeApexDomain(new URL(publicUrl).hostname);
    } catch {
      /* ignore */
    }
  }

  const serverHost = process.env.DEFAULT_SERVER_HOSTNAME?.trim();
  if (serverHost) {
    const apex = normalizeApexDomain(serverHost).replace(/^server\d+\./, "");
    if (apex.includes(".")) return apex;
  }

  const ns1 = process.env.DNS_NS1?.trim();
  if (ns1) {
    const apex = normalizeApexDomain(ns1).replace(/^ns\d+\./, "");
    if (apex.includes(".")) return apex;
  }

  return null;
}

export function requirePanelBaseDomain(): string {
  const domain = getPanelBaseDomain();
  if (!domain) {
    throw new Error(
      "PANEL_HOSTNAME (or PANEL_PUBLIC_URL) is not set. " +
        "Set it in .env or complete admin first-login with your main domain."
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
    if (key in updates) {
      out.push(`${key}=${updates[key]}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }

  const next = out.join("\n").replace(/\n*$/, "\n");
  fs.writeFileSync(envPath, next, "utf8");
}

/** Persist base domain + derived DNS/panel keys after admin first login. */
export function persistPanelBaseDomainFromLogin(domainInput: string): string {
  const domain = normalizeApexDomain(domainInput);
  const panelPort = process.env.PANEL_PORT?.trim() || "3100";
  const useHttps = shouldUseSecureCookies() || /^https:\/\//i.test(
    process.env.PANEL_PUBLIC_URL?.trim() || ""
  );
  const cleanPublicUrl = useHttps
    ? `https://${domain}`
    : `http://${domain}:${panelPort}`;

  upsertEnvKeys({
    PANEL_HOSTNAME: domain,
    PANEL_PUBLIC_URL: cleanPublicUrl,
    DNS_NS1: `ns1.${domain}`,
    DNS_NS2: `ns2.${domain}`,
    DEFAULT_SERVER_HOSTNAME: `server1.${domain}`,
    LETSENCRYPT_EMAIL: process.env.LETSENCRYPT_EMAIL?.trim() || `admin@${domain}`,
    NEXT_PUBLIC_TERMINAL_WS_URL: `wss://${domain}/terminal-ws/terminal`,
  });

  return domain;
}
