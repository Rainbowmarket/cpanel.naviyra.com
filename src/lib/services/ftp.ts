import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { hashPassword } from "@/lib/auth";
import { resolveHostingTarget } from "@/lib/hosting-targets";

function validateFtpUsername(username: string): string {
  const name = username.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_-]{2,31}$/.test(name)) {
    throw new Error(
      "FTP username must be 3–32 chars: start with a letter/underscore, then letters, digits, _ or -"
    );
  }
  return name;
}

export async function listFtpAccounts(userId: string, role?: string) {
  return prisma.ftpAccount.findMany({
    where: role === "ADMIN" ? undefined : { domain: { userId } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createFtpAccount(input: {
  target: string;
  userId: string;
  role?: "ADMIN" | "RESELLER" | "USER";
  username: string;
  password: string;
}) {
  const username = validateFtpUsername(input.username);
  if (!input.password || input.password.length < 8) {
    throw new Error("FTP password must be at least 8 characters");
  }

  const actor = { id: input.userId, role: input.role ?? ("USER" as const) };
  const hostingTarget = await resolveHostingTarget(input.target, actor, {
    excludeMailSubdomains: true,
  });

  const domain = await prisma.domain.findFirstOrThrow({
    where: {
      id: hostingTarget.domainId,
      ...(actor.role === "ADMIN" ? {} : { userId: input.userId }),
    },
    include: { server: true },
  });

  const homeDir = hostingTarget.documentRoot;
  const passwordHash = await hashPassword(input.password);

  const existing = await prisma.ftpAccount.findFirst({
    where: { username },
  });
  if (existing) {
    throw new Error(`FTP username '${username}' is already taken`);
  }

  const agentResult = await callAgent(
    {
      action: "create_ftp_account",
      username,
      password: input.password,
      homeDir,
    },
    domain.server.agentKey
  );

  if (!agentResult.success) {
    throw new Error(agentResult.error ?? "Failed to provision FTP account on server");
  }

  return prisma.ftpAccount.create({
    data: {
      username,
      passwordHash,
      homeDir,
      domainId: domain.id,
    },
  });
}

export async function deleteFtpAccount(
  accountId: string,
  userId: string,
  role?: string
) {
  const account = await prisma.ftpAccount.findFirstOrThrow({
    where: {
      id: accountId,
      ...(role === "ADMIN" ? {} : { domain: { userId } }),
    },
    include: { domain: { include: { server: true } } },
  });

  const agentResult = await callAgent(
    { action: "delete_ftp_account", username: account.username },
    account.domain.server.agentKey
  );
  if (!agentResult.success) {
    throw new Error(agentResult.error ?? "Failed to remove FTP account on server");
  }

  return prisma.ftpAccount.delete({ where: { id: account.id } });
}

/** Re-apply system user + password for an existing DB account (admin repair). */
export async function reprovisionFtpAccount(input: {
  username: string;
  password: string;
  userId: string;
  role?: "ADMIN" | "RESELLER" | "USER";
}) {
  const username = validateFtpUsername(input.username);
  const account = await prisma.ftpAccount.findFirstOrThrow({
    where: {
      username,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: { domain: { include: { server: true } } },
  });

  const agentResult = await callAgent(
    {
      action: "create_ftp_account",
      username,
      password: input.password,
      homeDir: account.homeDir,
    },
    account.domain.server.agentKey
  );
  if (!agentResult.success) {
    throw new Error(agentResult.error ?? "Failed to reprovision FTP account");
  }

  return prisma.ftpAccount.update({
    where: { id: account.id },
    data: { passwordHash: await hashPassword(input.password) },
  });
}
