import {
  getDnsZoneApex,
  getPanelHostname,
  isDocsExampleHostname,
  normalizeApexDomain,
} from "@/lib/base-domain";
import {
  getDefaultServerHostname,
  getDnsNs1,
  getDnsNs2,
  getMailHostname,
} from "@/lib/paths";
import { mailHostLabel } from "@/lib/dns/zone";

/**
 * Hostnames reserved for the control-panel nginx vhost.
 * Only PANEL_HOSTNAME / PANEL_PUBLIC_URL — not the DNS/marketing apex.
 */
export function getPanelHostnames(): Set<string> {
  const hosts = new Set<string>();
  const host = getPanelHostname();
  if (host) {
    hosts.add(host);
    hosts.add(`www.${host}`);
  }
  return hosts;
}

/**
 * Baseline infra labels. Prefer {@link getReservedInfraLabels} which merges
 * first labels from PANEL_HOSTNAME, DEFAULT_SERVER_HOSTNAME, DNS_NS*, etc.
 */
const BASE_RESERVED_LABELS = new Set([
  "www",
  "mail",
  "webmail",
  "cpanel",
  "panel",
  "ftp",
  "sftp",
  "smtp",
  "imap",
  "pop",
  "pop3",
]);

function firstLabelOfFqdn(fqdn: string, apex: string): string | null {
  const host = normalizeApexDomain(fqdn);
  if (!host || isDocsExampleHostname(host)) return null;
  if (host === apex) return null;
  if (!host.endsWith(`.${apex}`)) return null;
  const label = host.slice(0, -(apex.length + 1));
  const first = label.split(".")[0]?.toLowerCase();
  return first || null;
}

/** Labels reserved on the DNS apex, derived from env hostnames + a small baseline. */
export function getReservedInfraLabels(apex?: string | null): Set<string> {
  const zone = (apex || getDnsZoneApex() || "").toLowerCase();
  const labels = new Set(BASE_RESERVED_LABELS);
  if (!zone) return labels;

  const candidates = [
    getPanelHostname(),
    getDefaultServerHostname(),
    getDnsNs1(),
    getDnsNs2(),
    process.env.SECONDARY_SERVER_HOSTNAME?.trim(),
  ];
  for (const host of candidates) {
    const first = host ? firstLabelOfFqdn(host, zone) : null;
    if (first) labels.add(first);
  }
  return labels;
}

/** @deprecated Prefer getReservedInfraLabels — kept for callers expecting a Set constant. */
export const RESERVED_PANEL_SUBDOMAIN_LABELS = getReservedInfraLabels();

/** Labels allowed when provisioning the panel mail host (from MAIL_HOSTNAME). */
export function getMailHostProvisionLabels(panelDomain: string): Set<string> {
  const labels = new Set(["mail", "webmail"]);
  const host = getMailHostname(panelDomain);
  const label = mailHostLabel(host, panelDomain);
  if (label && label !== "@") {
    labels.add(label.split(".")[0]!.toLowerCase());
  }
  return labels;
}

export function isPanelHostname(hostname: string): boolean {
  const h = normalizeApexDomain(hostname);
  if (!h) return false;
  const hosts = getPanelHostnames();
  if (hosts.size === 0) return false;
  return hosts.has(h) || hosts.has(`www.${h}`) || hosts.has(h.replace(/^www\./, ""));
}

export function panelHostnameError(hostname: string): string {
  const host = getPanelHostname();
  return (
    `"${hostname}" is reserved for the Naviyra Control Panel` +
    (host ? ` (${host})` : "") +
    ". Use a different domain for customer websites."
  );
}

/**
 * FQDNs that should appear on the SSL page (panel, primary server, NS, secondary).
 * All values come from env / helpers — never hardcoded customer domains.
 */
export function getInfraSslHostnames(): string[] {
  const apex = getDnsZoneApex();
  if (!apex) return [];
  const out = new Set<string>();
  const add = (raw?: string | null) => {
    if (!raw?.trim()) return;
    const h = normalizeApexDomain(raw);
    if (!h || isDocsExampleHostname(h)) return;
    if (h === apex || h.endsWith(`.${apex}`)) out.add(h);
  };
  add(getPanelHostname());
  add(getDefaultServerHostname());
  add(getDnsNs1());
  add(getDnsNs2());
  add(process.env.SECONDARY_SERVER_HOSTNAME?.trim());
  return [...out];
}

/**
 * Block creating subdomains that would collide with panel / infra hosts
 * (e.g. www.{PANEL_HOSTNAME}, ns1.{zone}).
 * Mail host setup may pass allowMailHost to provision MAIL_HOSTNAME.
 */
export function assertAllowedPanelSubdomainLabel(
  label: string,
  parentDomain: string,
  opts?: {
    allowMailHost?: boolean;
    allowPanelHost?: boolean;
    /** Allow any reserved infra label (from env) so SSL can register hpanel/s1/ns*. */
    allowInfraHost?: boolean;
  }
) {
  const apex = getDnsZoneApex();
  if (!apex || parentDomain.toLowerCase() !== apex) return;

  const first = label.split(".")[0]?.toLowerCase() ?? "";
  if (opts?.allowMailHost && getMailHostProvisionLabels(apex).has(first)) {
    return;
  }

  const panelHost = getPanelHostname();
  if (panelHost && panelHost.endsWith(`.${apex}`)) {
    const panelLabel = panelHost.slice(0, -(apex.length + 1)).split(".")[0]?.toLowerCase();
    if (panelLabel && first === panelLabel) {
      if (opts?.allowPanelHost || opts?.allowInfraHost) return;
      throw new Error(
        `"${first}.${apex}" is reserved for the control panel. Issue SSL for it on the SSL page.`
      );
    }
  }

  if (getReservedInfraLabels(apex).has(first)) {
    if (opts?.allowInfraHost) return;
    throw new Error(
      `"${first}.${apex}" is reserved for panel infrastructure. Choose a different name.`
    );
  }
}

/** Mail/webmail, panel hostname, and infra labels on the DNS apex. */
export function isReservedPanelSubdomain(
  label: string,
  parentDomain: string
): boolean {
  const first = label.split(".")[0]?.toLowerCase() ?? "";
  const parent = parentDomain.trim().toLowerCase();
  const fqdn = `${label.trim().toLowerCase()}.${parent}`;

  if (!first || !parent) return false;
  if (isPanelHostname(fqdn) || isPanelHostname(`www.${fqdn}`)) return true;
  if (first === "mail" || first === "webmail") return true;

  const apex = getDnsZoneApex();
  return Boolean(apex && parent === apex && getReservedInfraLabels(apex).has(first));
}
