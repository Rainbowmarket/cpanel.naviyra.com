import { getPanelBaseDomain, normalizeApexDomain } from "@/lib/base-domain";

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
