import type { NextRequest } from "next/server";

/** Paths that use bearer/API keys or are public auth — skip browser CSRF Origin checks. */
const CSRF_EXEMPT_PREFIXES = [
  "/api/security/ingest",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/setup",
  "/api/webmail/login",
];

function isExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function hostMatches(urlHost: string, requestHost: string): boolean {
  const a = urlHost.toLowerCase();
  const b = requestHost.toLowerCase().split(":")[0] ?? "";
  const aHost = a.split(":")[0] ?? "";
  return aHost === b;
}

/**
 * CSRF defense-in-depth for cookie-authenticated mutating API calls.
 * SameSite=Lax is the primary defense; this rejects cross-site requests
 * and fails closed when Origin, Referer, and Sec-Fetch-Site are all absent.
 */
export function csrfOk(request: NextRequest | Request): boolean {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (isExempt(pathname)) return true;

  const auth = request.headers.get("authorization") ?? "";
  if (/^Bearer\s+\S+/i.test(auth)) return true;

  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  const requestHost = request.headers.get("host") ?? "";
  if (!requestHost) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return hostMatches(new URL(origin).host, requestHost);
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return hostMatches(new URL(referer).host, requestHost);
    } catch {
      return false;
    }
  }

  const site = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (site === "same-origin" || site === "none") {
    return true;
  }

  return false;
}
