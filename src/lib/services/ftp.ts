import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { hashPassword } from "@/lib/auth";

export async function listFtpAccounts(domainId: string, userId: string) {
  return prisma.ftpAccount.findMany({
    where: { domainId, domain: { userId } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createFtpAccount(input: {
  domainId: string;
  userId: string;
  username: string;
  password: string;
  homeDir?: string;
}) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, userId: input.userId },
    include: { server: true },
  });

  const homeDir = input.homeDir ?? domain.documentRoot;
  const passwordHash = await hashPassword(input.password);

  const account = await prisma.ftpAccount.create({
    data: {
      username: input.username,
      passwordHash,
      homeDir,
      domainId: domain.id,
    },
  });

  await callAgent(
    {
      action: "create_ftp_account",
      username: input.username,
      password: input.password,
      homeDir,
    },
    domain.server.agentKey
  );

  return account;
}

export async function deleteFtpAccount(accountId: string, userId: string) {
  const account = await prisma.ftpAccount.findFirstOrThrow({
    where: { id: accountId, domain: { userId } },
    include: { domain: { include: { server: true } } },
  });

  await callAgent(
    { action: "delete_ftp_account", username: account.username },
    account.domain.server.agentKey
  );

  return prisma.ftpAccount.delete({ where: { id: account.id } });
}
