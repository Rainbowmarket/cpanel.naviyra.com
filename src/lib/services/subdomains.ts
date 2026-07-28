import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey, getDefaultSubdomainRoot } from "@/lib/paths";
import { addSubdomainDnsRecord, removeSubdomainDnsRecord } from "@/lib/services/dns";
import type { DomainStatus } from "@/generated/prisma/client";

export async function listSubdomains(domainId: string, userId: string) {
  return prisma.subdomain.findMany({
    where: { domainId, domain: { userId } },
    include: {
      domain: { select: { name: true } },
      sslCerts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function provisionSubdomain(subdomain: {
  id: string;
  name: string;
  documentRoot: string;
  domain: { name: string; phpEnabled: boolean; server: { agentKey: string } };
}) {
  const agentResult = await callAgent(
    {
      action: "create_subdomain",
      domain: subdomain.domain.name,
      subdomain: subdomain.name,
      documentRoot: subdomain.documentRoot,
      phpEnabled: subdomain.domain.phpEnabled,
    },
    subdomain.domain.server.agentKey || getAgentApiKey()
  );

  const status: DomainStatus = agentResult.success ? "ACTIVE" : "ERROR";

  const updated = await prisma.subdomain.update({
    where: { id: subdomain.id },
    data: {
      status,
      lastError: agentResult.success ? null : (agentResult.error ?? "Agent failed"),
    },
    include: { domain: { select: { name: true, id: true } } },
  });

  if (agentResult.success) {
    try {
      const domain = await prisma.domain.findFirstOrThrow({
        where: { id: updated.domainId },
      });
      await addSubdomainDnsRecord(domain.id, subdomain.name);
    } catch (error) {
      console.error("Subdomain DNS record sync failed:", error);
    }
  }

  return updated;
}

export async function createSubdomain(input: {
  domainId: string;
  userId: string;
  name: string;
  documentRoot?: string;
}) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, userId: input.userId },
    include: { server: true },
  });

  const documentRoot =
    input.documentRoot ?? getDefaultSubdomainRoot(domain.name, input.name);

  const subdomain = await prisma.subdomain.create({
    data: {
      name: input.name,
      documentRoot,
      domainId: domain.id,
      status: "PENDING",
    },
  });

  return provisionSubdomain({
    id: subdomain.id,
    name: subdomain.name,
    documentRoot: subdomain.documentRoot,
    domain: {
      name: domain.name,
      phpEnabled: domain.phpEnabled,
      server: domain.server,
    },
  });
}

export async function retrySubdomain(subdomainId: string, userId: string) {
  const subdomain = await prisma.subdomain.findFirstOrThrow({
    where: { id: subdomainId, domain: { userId } },
    include: { domain: { include: { server: true } } },
  });

  const documentRoot = getDefaultSubdomainRoot(
    subdomain.domain.name,
    subdomain.name
  );

  await prisma.subdomain.update({
    where: { id: subdomain.id },
    data: { status: "PENDING", documentRoot, lastError: null },
  });

  return provisionSubdomain({
    id: subdomain.id,
    name: subdomain.name,
    documentRoot,
    domain: {
      name: subdomain.domain.name,
      phpEnabled: subdomain.domain.phpEnabled,
      server: subdomain.domain.server,
    },
  });
}

export async function updateSubdomainPath(
  subdomainId: string,
  userId: string,
  documentRoot: string
) {
  const subdomain = await prisma.subdomain.findFirstOrThrow({
    where: { id: subdomainId, domain: { userId } },
    include: { domain: { include: { server: true } } },
  });

  await prisma.subdomain.update({
    where: { id: subdomain.id },
    data: { documentRoot, status: "PENDING", lastError: null },
  });

  const agentResult = await callAgent(
    {
      action: "create_directory",
      path: documentRoot,
    },
    subdomain.domain.server.agentKey || getAgentApiKey()
  );

  const status: DomainStatus = agentResult.success ? "ACTIVE" : "ERROR";

  return prisma.subdomain.update({
    where: { id: subdomain.id },
    data: {
      status,
      lastError: agentResult.success ? null : (agentResult.error ?? "Failed to update path"),
    },
    include: { domain: { select: { name: true } } },
  });
}

export async function deleteSubdomain(
  subdomainId: string,
  userId: string,
  deleteFiles = false
) {
  const subdomain = await prisma.subdomain.findFirstOrThrow({
    where: { id: subdomainId, domain: { userId } },
    include: { domain: { include: { server: true } } },
  });

  await callAgent(
    {
      action: "delete_subdomain",
      domain: subdomain.domain.name,
      subdomain: subdomain.name,
      documentRoot: subdomain.documentRoot,
      deleteFiles,
    },
    subdomain.domain.server.agentKey || getAgentApiKey()
  );

  try {
    await removeSubdomainDnsRecord(subdomain.domainId, subdomain.name);
  } catch (error) {
    console.error("Subdomain DNS record removal failed:", error);
  }

  return prisma.subdomain.delete({ where: { id: subdomain.id } });
}
