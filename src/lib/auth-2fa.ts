import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fromB64url, hmacSign, hmacVerify, b64url } from "@/lib/crypto-hmac";
import { shouldUseSecureCookies } from "@/lib/cookie-secure";
import { requireSessionSecret } from "@/lib/secrets";
import { prisma } from "@/lib/prisma";

const PENDING_COOKIE = "naviyra_2fa_pending";
const PENDING_MAX_AGE = 5 * 60; // 5 minutes

type PendingClaims = {
  uid: string;
  sv: number;
  exp: number;
};

function cookieSecure(): boolean {
  return shouldUseSecureCookies();
}

function encodePending(claims: PendingClaims): string {
  const payload = b64url(JSON.stringify(claims));
  const sig = hmacSign(payload, requireSessionSecret());
  return `${payload}.${sig}`;
}

function decodePending(token: string): PendingClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!hmacVerify(payload, sig, requireSessionSecret())) return null;
  try {
    const claims = JSON.parse(
      fromB64url(payload).toString("utf8")
    ) as PendingClaims;
    if (!claims.uid || typeof claims.sv !== "number" || !claims.exp) {
      return null;
    }
    if (Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

export function applyPending2faCookie(
  response: NextResponse,
  userId: string,
  sessionVersion: number
): NextResponse {
  const exp = Math.floor(Date.now() / 1000) + PENDING_MAX_AGE;
  const value = encodePending({ uid: userId, sv: sessionVersion, exp });
  response.cookies.set(PENDING_COOKIE, value, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    maxAge: PENDING_MAX_AGE,
    path: "/",
  });
  return response;
}

export function clearPending2faCookie(response: NextResponse): NextResponse {
  response.cookies.set(PENDING_COOKIE, "", {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}

/** Returns user if pending 2FA cookie is valid (not a full session). */
export async function getPending2faUser(): Promise<{
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "RESELLER" | "USER";
  sessionVersion: number;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
} | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PENDING_COOKIE)?.value;
  if (!raw || !raw.includes(".")) return null;

  const claims = decodePending(raw);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.uid },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      sessionVersion: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });
  if (!user) return null;
  if (user.sessionVersion !== claims.sv) return null;
  if (!user.twoFactorEnabled || !user.twoFactorSecret) return null;

  return user;
}
