import { getPanelBaseDomain, normalizeApexDomain } from "@/lib/base-domain";
import { getMailHostname } from "@/lib/paths";
import { mailHostLabel } from "@/lib/dns/zone";

/**
 * Hostnames reserved for the Naviyra Control Panel itself.
 * Derived from PANEL_HOSTNAME / PANEL_PUBLIC_URL / related .env keys
 * (set at install or admin first login) — not hardcoded.
 */
export function getPanelHostnames(): Set<string> {
  const hosts = new Set<string>();
  const base = getPanelBaseDomain();
  if (base) {
    hosts.add(base);
    hosts.add(`www.${base}`);
  }
  return hosts;
}

/** First-level labels that must not be created under the panel base domain. */
const RESERVED_PANEL_SUBDOMAIN_LABELS = new Set([
  "www",
  "mail",
  "webmail",
  "cpanel",
  "panel",
  "ns1",
  "ns2",
  "chat",
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
  const base = getPanelBaseDomain();
  return (
    `"${hostname}" is reserved for the Naviyra Control Panel` +
    (base ? ` (${base})` : "") +
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
  const base = getPanelBaseDomain();
  if (!base || parentDomain.toLowerCase() !== base) return;

  const first = label.split(".")[0]?.toLowerCase() ?? "";
  if (opts?.allowMailHost && getMailHostProvisionLabels(base).has(first)) {
    return;
  }
  if (RESERVED_PANEL_SUBDOMAIN_LABELS.has(first)) {
    throw new Error(
      `"${first}.${base}" is reserved for panel infrastructure. Choose a different name.`
    );
  }
}
