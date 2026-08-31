import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId } from "@/lib/agent/target";
import { hashPassword } from "@/lib/auth";
import { domainAccessWhere, resolveHostingTarget } from "@/lib/hosting-targets";

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
  const actor = {
    id: userId,
    role: (role === "ADMIN" ? "ADMIN" : "USER") as "ADMIN" | "USER",
  };
  return prisma.ftpAccount.findMany({
    where: { domain: domainAccessWhere(actor, "ftp") },
    orderBy: { createdAt: "desc" },
  });
}

export async function createFtpAccount(input: {
  target: string;
  userId: string;
  role?: "ADMIN" | "USER";
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
    feature: "ftp",
  });

  const domain = await prisma.domain.findFirstOrThrow({
    where: {
      id: hostingTarget.domainId,
      ...domainAccessWhere(actor, "ftp"),
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
    await agentTargetForServerId(domain.serverId)
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
      domain: domainAccessWhere(
        { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
        "ftp"
      ),
    },
    include: { domain: { include: { server: true } } },
  });

  const agentResult = await callAgent(
    { action: "delete_ftp_account", username: account.username },
    await agentTargetForServerId(account.domain.serverId)
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
  role?: "ADMIN" | "USER";
}) {
  const username = validateFtpUsername(input.username);
  const account = await prisma.ftpAccount.findFirstOrThrow({
    where: {
      username,
      domain: domainAccessWhere(
        { id: input.userId, role: input.role === "ADMIN" ? "ADMIN" : "USER" },
        "ftp"
      ),
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
    await agentTargetForServerId(account.domain.serverId)
  );
  if (!agentResult.success) {
    throw new Error(agentResult.error ?? "Failed to reprovision FTP account");
  }

  return prisma.ftpAccount.update({
    where: { id: account.id },
    data: { passwordHash: await hashPassword(input.password) },
  });
}
