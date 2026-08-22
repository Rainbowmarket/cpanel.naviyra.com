import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import {
  type PanelPermissionKey,
  userHasPanelPermission,
} from "./panel-permissions";
import { fromB64url, hmacSign, hmacVerify, b64url } from "./crypto-hmac";
import { shouldUseSecureCookies } from "./cookie-secure";
import { requireSessionSecret } from "./secrets";

const SESSION_COOKIE = "naviyra_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: "/";
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
  /** null = not in a group, so all non-admin panel features are allowed */
  permissionKeys: string[] | null;
};

type SessionClaims = {
  uid: string;
  sv: number;
  exp: number;
};

/** Secure flag: auto when HTTPS panel URL / production; override with COOKIE_SECURE. */
function sessionCookieSecure(): boolean {
  return shouldUseSecureCookies();
}

function encodeSession(claims: SessionClaims): string {
  const payload = b64url(JSON.stringify(claims));
  const sig = hmacSign(payload, requireSessionSecret());
  return `${payload}.${sig}`;
}

function decodeSession(token: string): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!hmacVerify(payload, sig, requireSessionSecret())) return null;
  try {
    const claims = JSON.parse(
      fromB64url(payload).toString("utf8")
    ) as SessionClaims;
    if (!claims.uid || typeof claims.sv !== "number" || !claims.exp) {
      return null;
    }
    if (Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

function buildSessionCookie(
  userId: string,
  sessionVersion = 0
): { name: string; value: string; options: SessionCookieOptions } {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const value = encodeSession({ uid: userId, sv: sessionVersion, exp });
  return {
    name: SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: sessionCookieSecure(),
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    },
  };
}

/** Prefer this in Route Handlers — set cookie on the response object. */
export function applySessionCookie(
  response: NextResponse,
  userId: string,
  sessionVersion = 0
): NextResponse {
  const cookie = buildSessionCookie(userId, sessionVersion);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

export async function createSession(
  userId: string,
  sessionVersion = 0
): Promise<void> {
  const cookieStore = await cookies();
  const cookie = buildSessionCookie(userId, sessionVersion);
  cookieStore.set(cookie.name, cookie.value, cookie.options);
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}

/** Bump sessionVersion so all existing signed cookies become invalid. */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  // Legacy: raw cuid cookie (pre-signed). Reject — force re-login.
  if (!raw.includes(".")) return null;

  const claims = decodeSession(raw);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.uid },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      sessionVersion: true,
    },
  });
  if (!user) return null;
  if (user.sessionVersion !== claims.sv) return null;

  const memberships = await prisma.panelGroupMember.findMany({
    where: { userId: user.id },
    select: {
      group: {
        select: {
          permissions: { select: { key: true } },
        },
      },
    },
  });

  const permissionKeys =
    memberships.length === 0
      ? null
      : [
          ...new Set(
            memberships.flatMap((membership) =>
              membership.group.permissions.map((grant) => grant.key)
            )
          ),
        ];
  const groupAdmin = permissionKeys?.includes("admin") === true;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "ADMIN" || groupAdmin ? "ADMIN" : "USER",
    permissionKeys: user.role === "ADMIN" || groupAdmin ? null : permissionKeys,
  };
}

export function authFailureResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.message === "Forbidden") {
    return NextResponse.json(
      { error: "You do not have access to this feature" },
      { status: 403 }
    );
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function requireSessionUser(
  feature?: PanelPermissionKey
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  if (feature && !userHasPanelPermission(user, feature)) {
    throw new Error("Forbidden");
  }
  return user;
}

export async function requireAdminUser(): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (user.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  return user;
}
