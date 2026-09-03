/**
 * Whether to trust reverse-proxy request headers (X-Real-IP, X-Forwarded-Proto).
 * Default false — clients can spoof these if PANEL_PORT is exposed directly.
 * Set TRUST_PROXY=true only behind nginx (or similar) that overwrites them.
 */
export function trustProxyHeaders(): boolean {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}
