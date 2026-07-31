/**
 * Whether Set-Cookie should include Secure.
 *
 * - COOKIE_SECURE=true  → always Secure
 * - COOKIE_SECURE=false → never Secure (explicit local HTTP)
 * - unset → auto: Secure when panel URL is https:// or NODE_ENV=production
 */
export function shouldUseSecureCookies(): boolean {
  const explicit = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;

  const publicUrl = process.env.PANEL_PUBLIC_URL?.trim() || "";
  if (/^https:\/\//i.test(publicUrl)) return true;

  const terminalWs = process.env.NEXT_PUBLIC_TERMINAL_WS_URL?.trim() || "";
  if (/^wss:\/\//i.test(terminalWs)) return true;

  if (process.env.NODE_ENV === "production") return true;

  return false;
}
