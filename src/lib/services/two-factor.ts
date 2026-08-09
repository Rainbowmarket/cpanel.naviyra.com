import { authenticator } from "otplib";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const BACKUP_CODE_COUNT = 10;
const ISSUER = "Naviyra Panel";

authenticator.options = { window: 1 };

function normalizeCode(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}

function generateBackupPlaintexts(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // 8 chars hex groups: abcd-ef12
    const hex = randomBytes(4).toString("hex");
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
  }
  return codes;
}

export async function getTwoFactorStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      twoFactorEnabled: true,
      twoFactorPendingSecret: true,
      _count: { select: { backupCodes: { where: { usedAt: null } } } },
    },
  });
  return {
    enabled: user.twoFactorEnabled,
    setupPending: Boolean(user.twoFactorPendingSecret) && !user.twoFactorEnabled,
    unusedBackupCodes: user._count.backupCodes,
  };
}

export async function beginTwoFactorSetup(userId: string, email: string) {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 220,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorPendingSecret: encryptSecret(secret) },
  });

  return { otpauthUrl, qrDataUrl };
}

export async function confirmTwoFactorSetup(userId: string, code: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      twoFactorPendingSecret: true,
      twoFactorEnabled: true,
    },
  });
  if (!user.twoFactorPendingSecret) {
    throw new Error("No 2FA setup in progress. Start setup again.");
  }
  if (user.twoFactorEnabled) {
    throw new Error("Two-factor authentication is already enabled");
  }

  const secret = decryptSecret(user.twoFactorPendingSecret);
  const ok = authenticator.verify({
    token: normalizeCode(code),
    secret,
  });
  if (!ok) {
    throw new Error("Invalid authenticator code");
  }

  const plainCodes = generateBackupPlaintexts();
  const hashes = await Promise.all(plainCodes.map((c) => hashPassword(c)));

  await prisma.$transaction([
    prisma.backupCode.deleteMany({ where: { userId } }),
    prisma.backupCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: encryptSecret(secret),
        twoFactorPendingSecret: null,
        twoFactorEnabled: true,
        sessionVersion: { increment: 1 },
      },
    }),
  ]);

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sessionVersion: true },
  });

  return { backupCodes: plainCodes, sessionVersion: updated.sessionVersion };
}

export async function disableTwoFactor(userId: string, password: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, twoFactorEnabled: true },
  });
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Incorrect password");
  }

  await prisma.$transaction([
    prisma.backupCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        sessionVersion: { increment: 1 },
      },
    }),
  ]);

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  return { sessionVersion: updated.sessionVersion };
}

export async function regenerateBackupCodes(
  userId: string,
  opts: { password?: string; totpCode?: string }
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      passwordHash: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new Error("Two-factor authentication is not enabled");
  }

  let authorized = false;
  if (opts.password) {
    authorized = await verifyPassword(opts.password, user.passwordHash);
  }
  if (!authorized && opts.totpCode) {
    const secret = decryptSecret(user.twoFactorSecret);
    authorized = authenticator.verify({
      token: normalizeCode(opts.totpCode),
      secret,
    });
  }
  if (!authorized) {
    throw new Error("Password or authenticator code required");
  }

  const plainCodes = generateBackupPlaintexts();
  const hashes = await Promise.all(plainCodes.map((c) => hashPassword(c)));

  await prisma.$transaction([
    prisma.backupCode.deleteMany({ where: { userId } }),
    prisma.backupCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);

  return { backupCodes: plainCodes };
}

export async function verifyTotpOrBackupCode(
  userId: string,
  encryptedSecret: string,
  codeRaw: string
): Promise<"totp" | "backup"> {
  const code = normalizeCode(codeRaw);
  if (!code) throw new Error("Code required");

  const secret = decryptSecret(encryptedSecret);
  if (/^\d{6}$/.test(code) && authenticator.verify({ token: code, secret })) {
    return "totp";
  }

  // Backup codes look like abcd-ef12 (or without dash)
  const candidates = await prisma.backupCode.findMany({
    where: { userId, usedAt: null },
    select: { id: true, codeHash: true },
  });

  for (const row of candidates) {
    if (await verifyPassword(code, row.codeHash)) {
      await prisma.backupCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      return "backup";
    }
    // Also try with dash normalized
    const dashed =
      code.length === 8 && !code.includes("-")
        ? `${code.slice(0, 4)}-${code.slice(4)}`
        : null;
    if (dashed && (await verifyPassword(dashed, row.codeHash))) {
      await prisma.backupCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      return "backup";
    }
  }

  throw new Error("Invalid authenticator or backup code");
}

export async function cancelPendingSetup(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorPendingSecret: null },
  });
}
