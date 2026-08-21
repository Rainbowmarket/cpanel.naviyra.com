import {
  getDnsZoneApex,
  getPanelHostname,
  normalizeApexDomain,
} from "@/lib/base-domain";
import { getMailHostname } from "@/lib/paths";
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

/** First-level labels that must not be created under the DNS/marketing apex. */
export const RESERVED_PANEL_SUBDOMAIN_LABELS = new Set([
  "www",
  "mail",
  "webmail",
  "cpanel",
  "panel",
  "hpanel",
  "ns1",
  "ns2",
  "ftp",
  "sftp",
  "smtp",
  "imap",
  "pop",
  "pop3",
  "server1",
  "s1",
]);

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
 * Block creating subdomains that would collide with panel / infra hosts
 * (e.g. www.{PANEL_HOSTNAME}, ns1.{PANEL_HOSTNAME}).
 * Mail host setup may pass allowMailHost to provision MAIL_HOSTNAME.
 */
export function assertAllowedPanelSubdomainLabel(
  label: string,
  parentDomain: string,
  opts?: { allowMailHost?: boolean }
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
      throw new Error(
        `"${first}.${apex}" is reserved for the control panel. Choose a different name.`
      );
    }
  }

  if (RESERVED_PANEL_SUBDOMAIN_LABELS.has(first)) {
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
  return Boolean(apex && parent === apex && RESERVED_PANEL_SUBDOMAIN_LABELS.has(first));
}
