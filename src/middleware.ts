import { NextRequest, NextResponse } from "next/server";
import { csrfOk } from "@/lib/csrf";

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

/**
 * Exclude large multipart uploads from middleware so Next.js does not
 * clone/truncate the body (default proxy buffer is 10MB → FormData parse errors).
 * CSRF for /api/file-manager/upload is enforced in the route handler.
 */
export const config = {
  matcher: ["/", "/api/((?!file-manager/upload$).*)"],
};
