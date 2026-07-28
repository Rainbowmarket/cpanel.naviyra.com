import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";

const MAIL_SESSION_COOKIE = "naviyra_mail_session";
const MAIL_SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type MailSession = {
  accountId: string;
  email: string;
};

function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === "true";
}

export async function createMailSession(accountId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MAIL_SESSION_COOKIE, accountId, {
    httpOnly: true,
    secure: cookieSecure(),
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
  const accountId = cookieStore.get(MAIL_SESSION_COOKIE)?.value;
  if (!accountId) return null;

  const account = await prisma.mailAccount.findUnique({
    where: { id: accountId },
    select: { id: true, email: true, isActive: true },
  });

  if (!account || !account.isActive) return null;
  return { accountId: account.id, email: account.email };
}

/** Login with mailbox email + password (panel-stored hash). */
export async function authenticateMailbox(
  email: string,
  password: string
): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  const account = await prisma.mailAccount.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, passwordHash: true, isActive: true },
  });

  if (!account || !account.isActive) return null;
  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) return null;
  return { id: account.id, email: account.email };
}
