import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/mail/system-mail";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Always succeeds from the caller's perspective (no email enumeration).
 * Sends mail only when the account exists.
 */
export async function requestPasswordReset(emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) return;

  // Invalidate previous unused tokens
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id, usedAt: null },
  });

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    token,
  });
}

export async function resetPasswordWithToken(
  tokenRaw: string,
  newPassword: string
): Promise<void> {
  const token = tokenRaw.trim();
  if (!token || newPassword.length < 8) {
    throw new Error("Invalid reset request");
  }

  const tokenHash = hashToken(token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true } } },
  });

  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw new Error("This reset link is invalid or has expired");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { userId: row.userId, usedAt: null, id: { not: row.id } },
    }),
  ]);
}
