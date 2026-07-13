import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey, getDefaultDocumentRoot } from "@/lib/paths";
import { deleteDnsZoneForDomain, syncDnsZone } from "@/lib/services/dns";
import type { DomainStatus } from "@/generated/prisma/client";

export async function listDomains(userId: string) {
  return prisma.domain.findMany({
    where: { userId },
    include: {
      server: { select: { name: true, hostname: true } },
      subdomains: true,
      sslCerts: { orderBy: { createdAt: "desc" }, take: 1 },
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
  server: { agentKey: string };
}) {
  const agentKey = domain.server.agentKey || getAgentApiKey();

  const agentResult = await callAgent(
    {
      action: "create_domain",
      domain: domain.name,
      documentRoot: domain.documentRoot,
      phpEnabled: domain.phpEnabled,
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

  if (agentResult.success) {
    try {
      await syncDnsZone(domain.id);
    } catch (error) {
      console.error("DNS zone sync failed:", error);
    }
  }

  return updated;
}

export async function createDomain(input: {
  userId: string;
  serverId: string;
  name: string;
  documentRoot?: string;
  phpEnabled?: boolean;
}) {
  const documentRoot =
    input.documentRoot ?? getDefaultDocumentRoot(input.name);

  await prisma.server.findUniqueOrThrow({
    where: { id: input.serverId },
  });

  const domain = await prisma.domain.create({
    data: {
      name: input.name,
      documentRoot,
      phpEnabled: input.phpEnabled ?? true,
      userId: input.userId,
      serverId: input.serverId,
      status: "PENDING",
    },
    include: { server: true },
  });

  return provisionDomain(domain);
}

export async function retryDomain(domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

  const documentRoot = getDefaultDocumentRoot(domain.name);

  await prisma.domain.update({
    where: { id: domain.id },
    data: { status: "PENDING", documentRoot, lastError: null },
  });

  return provisionDomain({ ...domain, documentRoot });
}

export async function deleteDomain(domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

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
