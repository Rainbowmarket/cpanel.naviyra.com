import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { hashPassword } from "@/lib/auth";
import { getAgentApiKey, getMailHostname } from "@/lib/paths";
import { mailHostLabel } from "@/lib/dns/zone";
import { ensureMailDnsRecords } from "@/lib/services/dns";
import { issueSubdomainSslCertificate } from "@/lib/services/ssl";
import { createSubdomain } from "@/lib/services/subdomains";
import { cleanupMailbox, initializeMailbox } from "@/lib/services/webmail";

async function getMailAccount(accountId: string, userId: string) {
  return prisma.mailAccount.findFirstOrThrow({
    where: { id: accountId, mailDomain: { domain: { userId } } },
    include: { mailDomain: { include: { domain: { include: { server: true } } } } },
  });
}

export async function ensureMailDomain(domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
  });

  return prisma.mailDomain.upsert({
    where: { domainId: domain.id },
    create: { domainId: domain.id },
    update: {},
  });
}

export async function listMailAccounts(userId: string, domainId?: string | null) {
  if (domainId) {
    const mailDomain = await prisma.mailDomain.findFirst({
      where: { domainId, domain: { userId } },
      include: {
        accounts: { orderBy: { createdAt: "desc" } },
        aliases: true,
        domain: { select: { id: true, name: true } },
      },
    });
    if (!mailDomain) return { accounts: [], aliases: [] };
    return {
      accounts: mailDomain.accounts.map((a) => ({
        ...a,
        domainId: mailDomain.domain.id,
        domainName: mailDomain.domain.name,
      })),
      aliases: mailDomain.aliases,
    };
  }

  const accounts = await prisma.mailAccount.findMany({
    where: { mailDomain: { domain: { userId } } },
    orderBy: [{ email: "asc" }],
    include: {
      mailDomain: { include: { domain: { select: { id: true, name: true } } } },
    },
  });

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.email,
      quotaMb: a.quotaMb,
      isActive: a.isActive,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      mailDomainId: a.mailDomainId,
      passwordHash: a.passwordHash,
      domainId: a.mailDomain.domain.id,
      domainName: a.mailDomain.domain.name,
    })),
    aliases: [],
  };
}

/** DNS + mail subdomain + SSL for mail.{domain} (or MAIL_HOSTNAME label). */
export async function ensureMailHostSetup(domainId: string, userId: string) {
  await ensureMailDnsRecords(domainId, userId);

  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
  });

  const mailLabel = mailHostLabel(getMailHostname(domain.name), domain.name);
  if (!mailLabel || mailLabel === "@") return { mailHost: getMailHostname(domain.name) };

  let subdomain = await prisma.subdomain.findUnique({
    where: { domainId_name: { domainId, name: mailLabel } },
  });

  if (!subdomain) {
    subdomain = await createSubdomain({
      domainId,
      userId,
      name: mailLabel,
      allowMailHost: true,
      allowPanelDomain: true,
    });
  }

  const existingCert = await prisma.sslCertificate.findFirst({
    where: {
      subdomainId: subdomain.id,
      status: { in: ["ACTIVE", "PENDING"] },
    },
  });

  if (!existingCert) {
    try {
      await issueSubdomainSslCertificate({
        subdomainId: subdomain.id,
        userId,
        autoRenew: true,
      });
    } catch (error) {
      // Public DNS may lag (e.g. Cloudflare A record not yet set). Nginx HTTP
      // proxy is still useful; SSL can be retried on next mailbox/deploy.
      console.error("Mail host SSL issue failed:", error);
    }
  }

  return {
    mailHost: getMailHostname(domain.name),
    subdomainId: subdomain.id,
  };
}

export async function createMailAccount(input: {
  domainId: string;
  userId: string;
  localPart: string;
  password: string;
  quotaMb?: number;
}) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, userId: input.userId },
    include: { server: true, mailDomain: true },
  });

  const mailDomain =
    domain.mailDomain ??
    (await prisma.mailDomain.create({ data: { domainId: domain.id } }));

  const email = `${input.localPart}@${domain.name}`;
  const passwordHash = await hashPassword(input.password);

  const account = await prisma.mailAccount.create({
    data: {
      email,
      passwordHash,
      quotaMb: input.quotaMb ?? 1024,
      mailDomainId: mailDomain.id,
    },
  });

  await callAgent(
    {
      action: "create_mail_account",
      email,
      password: input.password,
      quotaMb: input.quotaMb,
    },
    domain.server.agentKey || getAgentApiKey()
  );

  try {
    await ensureMailHostSetup(domain.id, input.userId);
  } catch (error) {
    console.error("Mail host setup failed:", error);
  }

  try {
    await initializeMailbox(email);
  } catch (error) {
    console.error("Mailbox initialization failed:", error);
  }

  return account;
}

export async function deleteMailAccount(accountId: string, userId: string) {
  const account = await getMailAccount(accountId, userId);

  await callAgent(
    { action: "delete_mail_account", email: account.email },
    account.mailDomain.domain.server.agentKey || getAgentApiKey()
  );

  try {
    await cleanupMailbox(account.email);
  } catch (error) {
    console.error("Mailbox cleanup failed:", error);
  }

  return prisma.mailAccount.delete({ where: { id: account.id } });
}

export async function resetMailPassword(
  accountId: string,
  userId: string,
  password: string
) {
  const account = await getMailAccount(accountId, userId);
  const passwordHash = await hashPassword(password);

  await callAgent(
    {
      action: "reset_mail_password",
      email: account.email,
      password,
    },
    account.mailDomain.domain.server.agentKey || getAgentApiKey()
  );

  return prisma.mailAccount.update({
    where: { id: account.id },
    data: { passwordHash },
  });
}

export async function setMailAccountActive(
  accountId: string,
  userId: string,
  isActive: boolean
) {
  const account = await getMailAccount(accountId, userId);

  await callAgent(
    {
      action: "set_mail_account_active",
      email: account.email,
      isActive,
    },
    account.mailDomain.domain.server.agentKey || getAgentApiKey()
  );

  return prisma.mailAccount.update({
    where: { id: account.id },
    data: { isActive },
  });
}
