import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { sessionCookieShouldBeSecure } from "@/lib/cookie-secure";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId } from "@/lib/agent/target";
import { fromB64url, hmacSign, hmacVerify, b64url } from "@/lib/crypto-hmac";
import { requireSessionSecret } from "@/lib/secrets";

const MAIL_SESSION_COOKIE = "naviyra_mail_session";
const MAIL_SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type MailSession = {
  accountId: string;
  email: string;
};

export type MailAuthResult =
  | { ok: true; id: string; email: string }
  | {
      ok: false;
      code: "invalid" | "disabled";
      message: string;
      attemptsLeft?: number;
    };

type MailClaims = {
  aid: string;
  exp: number;
};

async function cookieSecure(): Promise<boolean> {
  return sessionCookieShouldBeSecure();
}

function maxFailedLogins(): number {
  const raw = Number(process.env.MAIL_MAX_FAILED_LOGINS ?? "3");
  if (!Number.isFinite(raw) || raw < 1) return 3;
  return Math.floor(raw);
}

function encodeMailSession(accountId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAIL_SESSION_MAX_AGE;
  const payload = b64url(JSON.stringify({ aid: accountId, exp } satisfies MailClaims));
  const sig = hmacSign(payload, requireSessionSecret());
  return `${payload}.${sig}`;
}

function decodeMailSession(token: string): MailClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!hmacVerify(payload, sig, requireSessionSecret())) return null;
  try {
    const claims = JSON.parse(fromB64url(payload).toString("utf8")) as MailClaims;
    if (!claims.aid || typeof claims.exp !== "number") return null;
    if (Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function createMailSession(accountId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MAIL_SESSION_COOKIE, encodeMailSession(accountId), {
    httpOnly: true,
    secure: await cookieSecure(),
    sameSite: "lax",
    maxAge: MAIL_SESSION_MAX_AGE,
    path: "/",
  });
}

export async function destroyMailSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(MAIL_SESSION_COOKIE);
}

export async function getMailSession(): Promise<MailSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(MAIL_SESSION_COOKIE)?.value;
  if (!raw) return null;

  // Legacy: raw accountId cookie (pre-signed). Reject — force re-login.
  if (!raw.includes(".")) return null;

  const claims = decodeMailSession(raw);
  if (!claims) return null;

  const account = await prisma.mailAccount.findUnique({
    where: { id: claims.aid },
    select: { id: true, email: true, isActive: true },
  });

  if (!account || !account.isActive) return null;
  return { accountId: account.id, email: account.email };
}

/** Login with mailbox email + password. Locks mailbox after N failed attempts. */
export async function authenticateMailbox(
  email: string,
  password: string
): Promise<MailAuthResult> {
  const normalized = email.trim().toLowerCase();
  const maxFails = maxFailedLogins();

  const account = await prisma.mailAccount.findUnique({
    where: { email: normalized },
    include: {
      mailDomain: { include: { domain: { include: { server: true } } } },
    },
  });

  if (!account) {
    return {
      ok: false,
      code: "invalid",
      message: "Invalid email or password",
    };
  }

  if (!account.isActive) {
    return {
      ok: false,
      code: "disabled",
      message:
        "This mailbox is disabled after too many failed sign-in attempts. Contact your administrator to reactivate it.",
    };
  }

  const ok = await verifyPassword(password, account.passwordHash);
  if (ok) {
    if (account.failedLoginCount > 0 || account.lockedAt) {
      await prisma.mailAccount.update({
        where: { id: account.id },
        data: { failedLoginCount: 0, lockedAt: null },
      });
    }
    return { ok: true, id: account.id, email: account.email };
  }

  const nextCount = account.failedLoginCount + 1;
  if (nextCount >= maxFails) {
    await prisma.mailAccount.update({
      where: { id: account.id },
      data: {
        failedLoginCount: nextCount,
        isActive: false,
        lockedAt: new Date(),
      },
    });

    try {
      await callAgent(
        {
          action: "set_mail_account_active",
          email: account.email,
          isActive: false,
        },
        await agentTargetForServerId(account.mailDomain.domain.serverId)
      );
    } catch (error) {
      console.error("Failed to disable mailbox on mail server:", error);
    }

    return {
      ok: false,
      code: "disabled",
      message: `Mailbox locked after ${maxFails} failed sign-in attempts. Contact your administrator to reactivate it.`,
    };
  }

  await prisma.mailAccount.update({
    where: { id: account.id },
    data: { failedLoginCount: nextCount },
  });

  const left = maxFails - nextCount;
  return {
    ok: false,
    code: "invalid",
    message: `Invalid email or password. ${left} attempt${left === 1 ? "" : "s"} remaining before this mailbox is disabled.`,
    attemptsLeft: left,
  };
}
