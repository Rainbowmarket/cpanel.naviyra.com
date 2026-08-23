/**
 * Session cookie Secure flag vs public https URL.
 *
 * COOKIE_SECURE=false → never Secure (HTTP-only access).
 * Otherwise Secure follows the *current request*:
 *   X-Forwarded-Proto, Forwarded, or Host port (:3100 = HTTP, :443 = HTTPS).
 * Do not use PANEL_PUBLIC_URL here — that is https://hpanel.example.com even when
 * the admin is still opening http://IP:3100, which made browsers drop the cookie
 * and bounce back to /login.
 */

type HeaderReader = { get(name: string): string | null };

export function httpsFromIncomingHeaders(h: HeaderReader): boolean | null {
  const xf = (h.get("x-forwarded-proto") || "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (xf === "https") return true;
  if (xf === "http") return false;

  const forwarded = h.get("forwarded") || "";
  const proto = forwarded.match(/(?:^|[;,]\s*)proto=(https?)/i)?.[1]?.toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;

  const host = (h.get("host") || "").toLowerCase();
  if (host.endsWith(":443")) return true;
  if (/:\d+$/.test(host)) return false;
  return null;
}

/** For generating https:// links in emails / redirects (not Set-Cookie). */
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

/** Secure on Set-Cookie: match this request, not the configured public URL. */
export async function sessionCookieShouldBeSecure(): Promise<boolean> {
  const explicit = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === "false" || explicit === "0") return false;

  try {
    const { headers } = await import("next/headers");
    const known = httpsFromIncomingHeaders(await headers());
    if (known !== null) return known;
  } catch {
    /* not in a request (tests, scripts) */
  }

  if (explicit === "true" || explicit === "1") return true;
  return shouldUseSecureCookies();
}
