import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey, getDefaultDocumentRoot } from "@/lib/paths";
import { getDnsZoneApex } from "@/lib/base-domain";
import { isPanelHostname, panelHostnameError } from "@/lib/panel-host";
import { assertValidHostname } from "@/lib/hostname";
import { deleteDnsZoneForDomain, syncDnsZone } from "@/lib/services/dns";
import { phpEnabledForAppType, removeSiteAppUnit } from "@/lib/services/apps";
import { ensurePanelSslSynced } from "@/lib/services/ssl";
import type { AppType, DomainStatus } from "@/generated/prisma/client";

/**
 * Ensure the DNS/marketing apex (e.g. naviyra.uk) exists as a Domain row so
 * admins can host the brand site and subdomains like block.naviyra.uk.
 * Does not provision the control-panel vhost (PANEL_HOSTNAME).
 */
export async function ensurePanelBaseDomain(userId: string) {
  const name = getDnsZoneApex();
  if (!name) return null;

  const existing = await prisma.domain.findUnique({
    where: { name },
    include: { server: true, dnsZone: { select: { id: true } } },
  });
  if (existing) {
    if (existing.status !== "ACTIVE") {
      const updated = await prisma.domain.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", lastError: null },
        include: { server: true, dnsZone: { select: { id: true } } },
      });
      if (!updated.dnsZone) {
        try {
          await syncDnsZone(updated.id);
        } catch (error) {
          console.error("DNS zone sync failed:", error);
        }
      }
      return updated;
    }
    if (!existing.dnsZone) {
      try {
        await syncDnsZone(existing.id);
      } catch (error) {
        console.error("DNS zone sync failed:", error);
      }
    }
    return existing;
  }

  const server = await prisma.server.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!server) {
    throw new Error("No active server configured");
  }

  const created = await prisma.domain.create({
    data: {
      name,
      documentRoot: getDefaultDocumentRoot(name),
      phpEnabled: false,
      appType: "STATIC",
      userId,
      serverId: server.id,
      status: "ACTIVE",
    },
    include: { server: true },
  });
  try {
    await syncDnsZone(created.id);
  } catch (error) {
    console.error("DNS zone sync failed:", error);
  }
  return created;
}

export async function listDomains(
  userId: string,
  opts?: { ensurePanel?: boolean; role?: "ADMIN" | "RESELLER" | "USER" }
) {
  if (opts?.ensurePanel) {
    try {
      await ensurePanelBaseDomain(userId);
    } catch (error) {
      console.error("ensurePanelBaseDomain failed:", error);
    }
  }

  try {
    await ensurePanelSslSynced(opts?.role === "ADMIN" ? undefined : userId);
  } catch (error) {
    console.error("ensurePanelSslSynced failed:", error);
  }

  const where = opts?.role === "ADMIN" ? {} : { userId };

  return prisma.domain.findMany({
    where,
    include: {
      server: { select: { name: true, hostname: true } },
      user: { select: { id: true, name: true, email: true } },
      subdomains: true,
      sslCerts: {
        where: { subdomainId: null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { ftpAccounts: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function provisionDomain(domain: {
  id: string;
  name: string;
  documentRoot: string;
  phpEnabled: boolean;
  appType: AppType;
  upstreamPort: number | null;
  server: { agentKey: string };
}) {
  const agentKey = domain.server.agentKey || getAgentApiKey();

  const agentResult = await callAgent(
    {
      action: "create_domain",
      domain: domain.name,
      documentRoot: domain.documentRoot,
      phpEnabled: domain.phpEnabled,
      appType: domain.appType,
      upstreamPort: domain.upstreamPort,
    },
    agentKey
  );

  const status: DomainStatus = agentResult.success ? "ACTIVE" : "ERROR";

  const updated = await prisma.domain.update({
    where: { id: domain.id },
    data: {
      status,
      lastError: agentResult.success ? null : (agentResult.error ?? "Agent failed"),
    },
  });

  try {
    await syncDnsZone(domain.id);
  } catch (error) {
    console.error("DNS zone sync failed:", error);
  }

  return updated;
}

export async function createDomain(input: {
  userId: string;
  serverId: string;
  name: string;
  phpEnabled?: boolean;
  appType?: AppType;
}) {
  const name = assertValidHostname(input.name);
  if (isPanelHostname(name)) {
    throw new Error(panelHostnameError(name));
  }

  // Document roots are never taken from client input — always derived.
  const documentRoot = getDefaultDocumentRoot(name);

  await prisma.server.findUniqueOrThrow({
    where: { id: input.serverId },
  });

  const appType: AppType =
    input.appType ??
    (input.phpEnabled === false ? "STATIC" : "PHP");
  const phpEnabled = phpEnabledForAppType(appType);

  const domain = await prisma.domain.create({
    data: {
      name,
      documentRoot,
      phpEnabled,
      appType,
      userId: input.userId,
      serverId: input.serverId,
      status: "PENDING",
    },
    include: { server: true },
  });

  return provisionDomain(domain);
}

export async function retryDomain(
  domainId: string,
  actor: { id: string; role: "ADMIN" | "RESELLER" | "USER" }
) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: {
      id: domainId,
      ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
    },
    include: { server: true },
  });

  if (isPanelHostname(domain.name)) {
    return prisma.domain.update({
      where: { id: domain.id },
      data: {
        status: "ACTIVE",
        lastError: null,
        documentRoot: getDefaultDocumentRoot(domain.name),
      },
    });
  }

  const documentRoot = getDefaultDocumentRoot(domain.name);

  await prisma.domain.update({
    where: { id: domain.id },
    data: { status: "PENDING", documentRoot, lastError: null },
  });

  return provisionDomain({ ...domain, documentRoot });
}

export async function deleteDomain(
  domainId: string,
  actor: { id: string; role: "ADMIN" | "RESELLER" | "USER" }
) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: {
      id: domainId,
      ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
    },
    include: { server: true, subdomains: true },
  });

  if (isPanelHostname(domain.name)) {
    throw new Error(panelHostnameError(domain.name));
  }

  const ownerId = domain.userId;
  for (const sub of domain.subdomains) {
    await removeSiteAppUnit("subdomain", sub.id, ownerId).catch(() => undefined);
  }
  await removeSiteAppUnit("domain", domain.id, ownerId).catch(() => undefined);

  await callAgent(
    { action: "delete_domain", domain: domain.name },
    domain.server.agentKey || getAgentApiKey()
  );

  try {
    await deleteDnsZoneForDomain(
      domain.name,
      domain.server.agentKey || getAgentApiKey()
    );
  } catch (error) {
    console.error("DNS zone delete failed:", error);
  }

  return prisma.domain.delete({ where: { id: domain.id } });
}
