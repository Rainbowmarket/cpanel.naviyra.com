import { NextRequest, NextResponse } from "next/server";

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
 * SameSite=Lax already blocks classic cross-site POSTs; this rejects
 * mismatched Origin/Referer when those headers are present.
 */
function csrfOk(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
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

  // Some same-origin clients omit Origin (e.g. older browsers / navigations).
  const site = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (site === "same-origin" || site === "none" || site === "") {
    return true;
  }

  return false;
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  if (host.startsWith("mail.") && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/webmail";
    return NextResponse.redirect(url);
  }

  if (request.nextUrl.pathname.startsWith("/api/") && !csrfOk(request)) {
    return NextResponse.json(
      { error: "CSRF check failed (invalid Origin)" },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
