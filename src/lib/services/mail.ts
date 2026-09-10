import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { hashPassword } from "@/lib/auth";
import { getMailHostname } from "@/lib/paths";
import { agentTargetForServerId } from "@/lib/agent/target";
import { mailHostLabel } from "@/lib/dns/zone";
import { ensureMailDnsRecords } from "@/lib/services/dns";
import { issueSubdomainSslCertificate } from "@/lib/services/ssl";
import { createSubdomain } from "@/lib/services/subdomains";
import { cleanupMailbox, initializeMailbox } from "@/lib/services/webmail";
import { domainAccessWhere } from "@/lib/hosting-targets";

async function getMailAccount(accountId: string, userId: string, role?: string) {
  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, mailDomain: { domain: access } },
    include: { mailDomain: { include: { domain: { include: { server: true } } } } },
  });
  if (!account) {
    throw new Error("Mailbox not found or you do not have access to it");
  }
  return account;
}

export async function ensureMailDomain(domainId: string, userId: string, role?: string) {
  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, ...access },
  });

  return prisma.mailDomain.upsert({
    where: { domainId: domain.id },
    create: { domainId: domain.id },
    update: {},
  });
}

export async function listMailAccounts(
  userId: string,
  domainId?: string | null,
  role?: string
) {
  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  if (domainId) {
    const mailDomain = await prisma.mailDomain.findFirst({
      where: { domainId, domain: access },
      include: {
        accounts: { orderBy: { createdAt: "desc" } },
        aliases: true,
        domain: { select: { id: true, name: true } },
      },
    });
    if (!mailDomain) return { accounts: [], aliases: [], mailDomains: [] };
    return {
      accounts: mailDomain.accounts.map((a) => ({
        ...a,
        domainId: mailDomain.domain.id,
        domainName: mailDomain.domain.name,
      })),
      aliases: mailDomain.aliases.map((row) => ({
        ...row,
        domainId: mailDomain.domain.id,
        domainName: mailDomain.domain.name,
        mailDomainId: mailDomain.id,
      })),
      mailDomains: [
        {
          id: mailDomain.id,
          domainId: mailDomain.domain.id,
          catchAllTo: mailDomain.catchAllTo,
          dkimSelector: mailDomain.dkimSelector,
          spamFilterOn: mailDomain.spamFilterOn,
          domain: mailDomain.domain,
        },
      ],
    };
  }

  const accounts = await prisma.mailAccount.findMany({
    where: { mailDomain: { domain: access } },
    orderBy: [{ email: "asc" }],
    include: {
      mailDomain: { include: { domain: { select: { id: true, name: true } } } },
    },
  });

  const aliasRows = await prisma.mailAlias.findMany({
    where: { mailDomain: { domain: access } },
    orderBy: { alias: "asc" },
    include: {
      mailDomain: {
        select: {
          id: true,
          catchAllTo: true,
          domainId: true,
          domain: { select: { id: true, name: true } },
        },
      },
    },
  });

  const mailDomains = await prisma.mailDomain.findMany({
    where: { domain: access },
    select: {
      id: true,
      domainId: true,
      catchAllTo: true,
      dkimSelector: true,
      spamFilterOn: true,
      domain: { select: { id: true, name: true } },
    },
  });

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      email: a.email,
      quotaMb: a.quotaMb,
      isActive: a.isActive,
      failedLoginCount: a.failedLoginCount,
      lockedAt: a.lockedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      mailDomainId: a.mailDomainId,
      passwordHash: a.passwordHash,
      domainId: a.mailDomain.domain.id,
      domainName: a.mailDomain.domain.name,
    })),
    aliases: aliasRows.map((row) => ({
      id: row.id,
      alias: row.alias,
      forwardTo: row.forwardTo,
      createdAt: row.createdAt,
      domainId: row.mailDomain.domain.id,
      domainName: row.mailDomain.domain.name,
      mailDomainId: row.mailDomainId,
    })),
    mailDomains,
  };
}

export async function createMailAlias(input: {
  domainId: string;
  userId: string;
  role?: string;
  localPart: string;
  forwardTo: string;
}) {
  const access = domainAccessWhere(
    { id: input.userId, role: input.role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, ...access },
    include: { server: true, mailDomain: true },
  });
  const mailDomain =
    domain.mailDomain ??
    (await prisma.mailDomain.create({ data: { domainId: domain.id } }));

  const local = input.localPart.trim().toLowerCase().replace(/@.*$/, "");
  if (!local || !/^[a-z0-9._+-]+$/i.test(local)) {
    throw new Error("Invalid alias local part");
  }
  const alias = `${local}@${domain.name}`;
  const forwardTo = input.forwardTo.trim().toLowerCase();
  if (!forwardTo.includes("@")) {
    throw new Error("forwardTo must be a full email address");
  }

  const existing = await prisma.mailAlias.findUnique({ where: { alias } });
  if (existing) throw new Error("Alias already exists");

  const row = await prisma.mailAlias.create({
    data: {
      alias,
      forwardTo,
      mailDomainId: mailDomain.id,
    },
  });

  await callAgent(
    { action: "create_mail_alias", alias, forwardTo },
    await agentTargetForServerId(domain.serverId)
  );

  return row;
}

export async function deleteMailAlias(
  aliasId: string,
  userId: string,
  role?: string
) {
  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const row = await prisma.mailAlias.findFirstOrThrow({
    where: { id: aliasId, mailDomain: { domain: access } },
    include: {
      mailDomain: { include: { domain: { select: { serverId: true } } } },
    },
  });

  await callAgent(
    { action: "delete_mail_alias", alias: row.alias },
    await agentTargetForServerId(row.mailDomain.domain.serverId)
  );

  await prisma.mailAlias.delete({ where: { id: row.id } });
  return { ok: true };
}

export async function setMailCatchAll(input: {
  domainId: string;
  userId: string;
  role?: string;
  forwardTo: string | null;
}) {
  const access = domainAccessWhere(
    { id: input.userId, role: input.role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, ...access },
    include: { server: true, mailDomain: true },
  });
  const mailDomain =
    domain.mailDomain ??
    (await prisma.mailDomain.create({ data: { domainId: domain.id } }));

  const catchKey = `@${domain.name}`;
  if (!input.forwardTo) {
    await callAgent(
      { action: "delete_mail_alias", alias: catchKey },
      await agentTargetForServerId(domain.serverId)
    );
    return prisma.mailDomain.update({
      where: { id: mailDomain.id },
      data: { catchAllTo: null },
    });
  }

  const forwardTo = input.forwardTo.trim().toLowerCase();
  if (!forwardTo.includes("@")) {
    throw new Error("Catch-all target must be a full email");
  }
  await callAgent(
    { action: "create_mail_alias", alias: catchKey, forwardTo },
    await agentTargetForServerId(domain.serverId)
  );
  return prisma.mailDomain.update({
    where: { id: mailDomain.id },
    data: { catchAllTo: forwardTo },
  });
}

export async function ensureDomainDkimSetup(
  domainId: string,
  userId: string,
  role?: string
) {
  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, ...access },
    include: { server: true, mailDomain: true },
  });
  const mailDomain =
    domain.mailDomain ??
    (await prisma.mailDomain.create({ data: { domainId: domain.id } }));

  const result = await callAgent(
    {
      action: "ensure_domain_dkim",
      domain: domain.name,
      selector: mailDomain.dkimSelector || "naviyra",
    },
    await agentTargetForServerId(domain.serverId)
  );
  if (!result.success) {
    throw new Error(result.error ?? "DKIM setup failed");
  }
  const data = result.data as {
    selector?: string;
    publicKey?: string;
    dnsValue?: string;
  };

  const updated = await prisma.mailDomain.update({
    where: { id: mailDomain.id },
    data: {
      dkimSelector: data.selector || mailDomain.dkimSelector,
      dkimPublicKey: data.publicKey || null,
      dkimDnsValue: data.dnsValue || null,
    },
  });

  try {
    await ensureMailDnsRecords(domainId, userId);
  } catch (error) {
    console.error("DKIM DNS publish failed:", error);
  }

  return updated;
}

export async function getMailAccountUsage(
  accountId: string,
  userId: string,
  role?: string
) {
  const account = await getMailAccount(accountId, userId, role);
  const result = await callAgent(
    { action: "mail_usage", email: account.email },
    await agentTargetForServerId(account.mailDomain.domain.serverId)
  );
  const usedBytes =
    result.success && result.data && typeof result.data === "object"
      ? Number((result.data as { usedBytes?: number }).usedBytes ?? 0)
      : 0;
  return {
    email: account.email,
    quotaMb: account.quotaMb,
    usedBytes,
    usedMb: Math.round((usedBytes / (1024 * 1024)) * 10) / 10,
  };
}

export async function updateMailAccountQuota(
  accountId: string,
  userId: string,
  quotaMb: number,
  role?: string
) {
  if (!Number.isFinite(quotaMb) || quotaMb < 1) {
    throw new Error("quotaMb must be at least 1");
  }
  const account = await getMailAccount(accountId, userId, role);
  await callAgent(
    {
      action: "set_mail_quota",
      email: account.email,
      quotaMb: Math.floor(quotaMb),
    },
    await agentTargetForServerId(account.mailDomain.domain.serverId)
  );
  return prisma.mailAccount.update({
    where: { id: account.id },
    data: { quotaMb: Math.floor(quotaMb) },
  });
}

export async function listMailQueueForUser(userId: string, role?: string) {
  if (role !== "ADMIN") throw new Error("Forbidden");
  const server = await prisma.server.findFirst({ orderBy: { createdAt: "asc" } });
  if (!server) return { items: [] };
  const result = await callAgent(
    { action: "mail_queue_list" },
    await agentTargetForServerId(server.id)
  );
  return result.data ?? { items: [] };
}

export async function flushMailQueueForAdmin(
  userId: string,
  role?: string,
  id?: string
) {
  if (role !== "ADMIN") throw new Error("Forbidden");
  const server = await prisma.server.findFirst({ orderBy: { createdAt: "asc" } });
  if (!server) throw new Error("No server");
  return callAgent(
    { action: "mail_queue_flush", id },
    await agentTargetForServerId(server.id)
  );
}

export async function deleteMailQueueForAdmin(
  userId: string,
  role: string | undefined,
  id: string
) {
  if (role !== "ADMIN") throw new Error("Forbidden");
  const server = await prisma.server.findFirst({ orderBy: { createdAt: "asc" } });
  if (!server) throw new Error("No server");
  return callAgent(
    { action: "mail_queue_delete", id },
    await agentTargetForServerId(server.id)
  );
}

export async function tailMailLogForAdmin(
  userId: string,
  role?: string,
  lines = 100
) {
  if (role !== "ADMIN") throw new Error("Forbidden");
  const server = await prisma.server.findFirst({ orderBy: { createdAt: "asc" } });
  if (!server) return { lines: [] };
  const result = await callAgent(
    { action: "mail_log_tail", lines },
    await agentTargetForServerId(server.id)
  );
  return result.data ?? { lines: [] };
}

export async function installMailSpamStack(userId: string, role?: string) {
  if (role !== "ADMIN") throw new Error("Forbidden");
  const server = await prisma.server.findFirst({ orderBy: { createdAt: "asc" } });
  if (!server) throw new Error("No server");
  const target = await agentTargetForServerId(server.id);
  const rspamd = await callAgent({ action: "install_rspamd" }, target);
  const clam = await callAgent({ action: "install_clamav" }, target);
  await prisma.mailDomain.updateMany({ data: { spamFilterOn: true } });
  return { rspamd, clam };
}

/** DNS + mail subdomain + SSL for mail.{domain} (or MAIL_HOSTNAME label). */
export async function ensureMailHostSetup(
  domainId: string,
  userId: string,
  role?: string
) {
  await ensureMailDnsRecords(domainId, userId);

  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, ...access },
    include: { server: true },
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

  // Always re-assert mail.* reverse-proxy (Runtime/SSL paths can overwrite it)
  try {
    const mailHost = getMailHostname(domain.name);
    await callAgent(
      { action: "ensure_mail_proxy", hostname: mailHost },
      await agentTargetForServerId(domain.serverId)
    );
  } catch (error) {
    console.error("ensure_mail_proxy failed:", error);
  }

  return {
    mailHost: getMailHostname(domain.name),
    subdomainId: subdomain.id,
  };
}

export async function createMailAccount(input: {
  domainId: string;
  userId: string;
  role?: string;
  localPart: string;
  password: string;
  quotaMb?: number;
}) {
  const access = domainAccessWhere(
    { id: input.userId, role: input.role === "ADMIN" ? "ADMIN" : "USER" },
    "mail"
  );
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, ...access },
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
    await agentTargetForServerId(domain.serverId)
  );

  try {
    await ensureMailHostSetup(domain.id, input.userId);
  } catch (error) {
    console.error("Mail host setup failed:", error);
  }

  try {
    await ensureDomainDkimSetup(domain.id, input.userId, input.role);
  } catch (error) {
    console.error("DKIM setup failed:", error);
  }

  try {
    await initializeMailbox(email);
  } catch (error) {
    console.error("Mailbox initialization failed:", error);
  }

  return account;
}

async function requireAgentOk(
  result: Awaited<ReturnType<typeof callAgent>>,
  fallback: string
) {
  if (result.success) return;
  throw new Error(result.error || fallback);
}

export async function deleteMailAccount(
  accountId: string,
  userId: string,
  role?: string
) {
  const account = await getMailAccount(accountId, userId, role);

  await requireAgentOk(
    await callAgent(
      { action: "delete_mail_account", email: account.email },
      await agentTargetForServerId(account.mailDomain.domain.serverId)
    ),
    "Mail server could not delete this mailbox"
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
  password: string,
  role?: string
) {
  const account = await getMailAccount(accountId, userId, role);
  const passwordHash = await hashPassword(password);

  await requireAgentOk(
    await callAgent(
      {
        action: "reset_mail_password",
        email: account.email,
        password,
      },
      await agentTargetForServerId(account.mailDomain.domain.serverId)
    ),
    "Mail server could not reset this password"
  );

  return prisma.mailAccount.update({
    where: { id: account.id },
    data: { passwordHash, failedLoginCount: 0, lockedAt: null },
  });
}

export async function setMailAccountActive(
  accountId: string,
  userId: string,
  isActive: boolean,
  role?: string
) {
  const account = await getMailAccount(accountId, userId, role);

  await requireAgentOk(
    await callAgent(
      {
        action: "set_mail_account_active",
        email: account.email,
        isActive,
      },
      await agentTargetForServerId(account.mailDomain.domain.serverId)
    ),
    "Mail server could not change mailbox status"
  );

  return prisma.mailAccount.update({
    where: { id: account.id },
    data: {
      isActive,
      ...(isActive
        ? { failedLoginCount: 0, lockedAt: null }
        : {}),
    },
  });
}
