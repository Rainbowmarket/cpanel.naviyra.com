/**
 * Interactive .env schema for the npx installer.
 * Keys and examples match .env.example in the panel root.
 */

export const SECRET_KEYS = ["AGENT_API_KEY", "SESSION_SECRET", "TWO_FACTOR_ENC_KEY"];

export function zoneApexFromHost(host) {
  const h = String(host || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase();
  const parts = h.split(".").filter(Boolean);
  if (parts.length >= 3) return parts.slice(1).join(".");
  return h;
}

export function derivedFromDomain(domain) {
  const host = String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const apex = zoneApexFromHost(host);
  return {
    PANEL_HOSTNAME: host,
    PANEL_PUBLIC_URL: host ? `https://${host}` : "",
    DNS_NS1: apex ? `ns1.${apex}` : "",
    DNS_NS2: apex ? `ns2.${apex}` : "",
    DEFAULT_SERVER_HOSTNAME: apex ? `s1.${apex}` : "",
    MAIL_HOSTNAME: "mail.{domain}",
    MAIL_FROM: apex ? `noreply@${apex}` : "",
    LETSENCRYPT_EMAIL: apex ? `admin@${apex}` : "",
    NEXT_PUBLIC_TERMINAL_WS_URL: host ? `wss://${host}/terminal-ws/terminal` : "",
  };
}

export function defaultAgentUrl(agentPort) {
  return `http://127.0.0.1:${agentPort || 4000}`;
}

/** Fields collected during install, in prompt order. */
export const INSTALL_STEPS = [
  {
    id: "core",
    title: "Panel domain & server",
    fields: [
      {
        key: "PANEL_HOSTNAME",
        label: "Panel domain",
        help: "Control-panel hostname. Can be a subdomain (hpanel.yourdomain.com) while nameservers stay on the zone apex.",
        example: "hpanel.yourdomain.com",
        required: true,
        validate: validateHostname,
      },
      {
        key: "SERVER_PUBLIC_IP",
        label: "Server public IPv4",
        help: "This machine's public IPv4 — used for DNS A records.",
        example: "203.0.113.10",
        required: true,
        validate: validateIpv4,
      },
      {
        key: "PANEL_PUBLIC_URL",
        label: "Public panel URL",
        help: "URL you (and customers) open in the browser.",
        example: "https://hpanel.yourdomain.com",
        required: true,
      },
    ],
  },
  {
    id: "dns-mail",
    title: "DNS & mail (defaults from your domain)",
    fields: [
      {
        key: "DNS_NS1",
        label: "Primary nameserver",
        help: "Hostname customers set as NS1. Stays on the zone apex (ns1.yourdomain.com), not ns1.hpanel.yourdomain.com.",
        example: "ns1.yourdomain.com",
        required: true,
      },
      {
        key: "DNS_NS2",
        label: "Secondary nameserver",
        help: "Hostname customers should set as NS2 at their registrar.",
        example: "ns2.yourdomain.com",
        required: true,
      },
      {
        key: "DEFAULT_SERVER_HOSTNAME",
        label: "Default server hostname",
        help: "Hostname shown for the primary hosting server (s1).",
        example: "s1.yourdomain.com",
        required: true,
      },
      {
        key: "MAIL_HOSTNAME",
        label: "Mail hostname template",
        help: "Deploy provisions this host for the zone apex (nginx webmail + Let's Encrypt).",
        example: "mail.{domain}",
        required: true,
      },
      {
        key: "MAIL_FROM",
        label: "System mail From address",
        help: "Password-reset From. Domain MUST have SPF that includes this server IP.",
        example: "noreply@yourdomain.com",
        required: true,
      },
      {
        key: "LETSENCRYPT_EMAIL",
        label: "Let's Encrypt contact email",
        help: "Used when issuing certificates. Defaults to admin@{domain}.",
        example: "admin@yourdomain.com",
        required: false,
      },
    ],
  },
  {
    id: "ports",
    title: "Ports & agent",
    fields: [
      {
        key: "PANEL_PORT",
        label: "Panel port",
        help: "Web UI listen port (nginx can reverse-proxy 443 → this).",
        example: "3000",
        required: true,
        validate: validatePort,
      },
      {
        key: "AGENT_PORT",
        label: "Agent port",
        help: "Local agent that runs hosting commands (keep loopback-only).",
        example: "4000",
        required: true,
        validate: validatePort,
      },
      {
        key: "AGENT_BIND_HOST",
        label: "Agent bind host",
        help: "127.0.0.1 recommended. Use 0.0.0.0 only behind a firewall.",
        example: "127.0.0.1",
        required: true,
      },
      {
        key: "AGENT_URL",
        label: "Agent URL",
        help: "How the panel reaches the agent.",
        example: "http://127.0.0.1:4000",
        required: true,
      },
      {
        key: "NAVIYRA_NO_BROWSER",
        label: "Skip opening a browser (true/false)",
        help: "true on headless servers.",
        example: "true",
        required: true,
        validate: validateBool,
      },
    ],
  },
];

export const FIXED_DEFAULTS = {
  DATABASE_URL: "file:./data/naviyra.db",
  BIND_ZONES_DIR: "/etc/bind/zones",
  BIND_NAMED_DIR: "/etc/bind/naviyra-zones.d",
  BIND_INCLUDE_FILE: "/etc/bind/naviyra-zones.conf",
  BIND_RELOAD_CMD: '"rndc reload"',
};

export function validateHostname(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "Domain is required.";
  if (/\s/.test(v) || v.includes("://")) return "Enter a hostname only, e.g. yourdomain.com";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v) && v !== "localhost") {
    return "Does not look like a domain. Example: yourdomain.com";
  }
  if (v.includes("yourdomain.com") || v.includes("example.com") || v.includes("example.org")) {
    return "That is a docs example. Use your real hostname, e.g. hpanel.naviyra.uk";
  }
  return null;
}

export function validateIpv4(value) {
  const v = String(value || "").trim();
  if (!v) return "Public IPv4 is required.";
  const parts = v.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p) || Number(p) > 255)) {
    return "Enter an IPv4 address. Example: 203.0.113.10";
  }
  return null;
}

export function validatePort(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return "Enter a port between 1 and 65535.";
  return null;
}

export function validateBool(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v !== "true" && v !== "false") return "Enter true or false.";
  return null;
}
