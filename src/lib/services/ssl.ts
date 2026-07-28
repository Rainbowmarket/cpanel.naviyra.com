import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey } from "@/lib/paths";
import type { SslStatus } from "@/generated/prisma/client";

function getCertificateHostname(cert: {
  domain: { name: string };
  subdomain?: { name: string } | null;
}) {
  return cert.subdomain
    ? `${cert.subdomain.name}.${cert.domain.name}`
    : cert.domain.name;
}

/** Keep only the newest certificate per domain or subdomain. */
async function dedupeSslCertificates(userId?: string) {
  const certs = await prisma.sslCertificate.findMany({
    where: userId ? { domain: { userId } } : undefined,
    orderBy: { createdAt: "desc" },
    select: { id: true, domainId: true, subdomainId: true },
  });

  const seenDomain = new Set<string>();
  const seenSubdomain = new Set<string>();
  const toDelete: string[] = [];

  for (const cert of certs) {
    if (cert.subdomainId) {
      if (seenSubdomain.has(cert.subdomainId)) {
        toDelete.push(cert.id);
      } else {
        seenSubdomain.add(cert.subdomainId);
      }
    } else if (seenDomain.has(cert.domainId)) {
      toDelete.push(cert.id);
    } else {
      seenDomain.add(cert.domainId);
    }
  }

  if (toDelete.length > 0) {
    await prisma.sslCertificate.deleteMany({
      where: { id: { in: toDelete } },
    });
  }
}

export async function listSslCertificates(userId: string) {
  await dedupeSslCertificates(userId);

  return prisma.sslCertificate.findMany({
    where: { domain: { userId } },
    include: {
      domain: { select: { name: true, id: true } },
      subdomain: { select: { name: true, id: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function finalizeSslCertificate(
  certId: string,
  agentResult: Awaited<ReturnType<typeof callAgent>>
) {
  const status: SslStatus = agentResult.success ? "ACTIVE" : "FAILED";
  const data = agentResult.data as
    | { issuedAt?: string; expiresAt?: string }
    | undefined;

  return prisma.sslCertificate.update({
    where: { id: certId },
    data: {
      status,
      issuedAt: data?.issuedAt ? new Date(data.issuedAt) : null,
      expiresAt: data?.expiresAt ? new Date(data.expiresAt) : null,
      lastError: agentResult.success ? null : agentResult.error,
    },
    include: {
      domain: { select: { name: true, id: true } },
      subdomain: { select: { name: true, id: true } },
    },
  });
}

export async function issueSslCertificate(input: {
  domainId: string;
  userId: string;
  includeWww?: boolean;
  autoRenew?: boolean;
}) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, userId: input.userId },
    include: { server: true },
  });

  await dedupeSslCertificates(input.userId);

  const existing = await prisma.sslCertificate.findFirst({
    where: { domainId: domain.id, subdomainId: null },
    orderBy: { createdAt: "desc" },
  });

  const subdomains = input.includeWww !== false ? ["www"] : [];
  const agentKey = domain.server.agentKey || getAgentApiKey();

  const cert = existing
    ? await prisma.sslCertificate.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          lastError: null,
          autoRenew: input.autoRenew ?? existing.autoRenew,
        },
      })
    : await prisma.sslCertificate.create({
        data: {
          domainId: domain.id,
          status: "PENDING",
          autoRenew: input.autoRenew ?? true,
        },
      });

  const agentResult = await callAgent(
    {
      action: "issue_ssl",
      domain: domain.name,
      subdomains,
      documentRoot: domain.documentRoot,
    },
    agentKey
  );

  return finalizeSslCertificate(cert.id, agentResult);
}

export async function issueSubdomainSslCertificate(input: {
  subdomainId: string;
  userId: string;
  autoRenew?: boolean;
}) {
  const subdomain = await prisma.subdomain.findFirstOrThrow({
    where: { id: input.subdomainId, domain: { userId: input.userId } },
    include: { domain: { include: { server: true } } },
  });

  await dedupeSslCertificates(input.userId);

  const existing = await prisma.sslCertificate.findFirst({
    where: { subdomainId: subdomain.id },
    orderBy: { createdAt: "desc" },
  });

  const hostname = `${subdomain.name}.${subdomain.domain.name}`;
  const agentKey = subdomain.domain.server.agentKey || getAgentApiKey();

  const cert = existing
    ? await prisma.sslCertificate.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          lastError: null,
          autoRenew: input.autoRenew ?? existing.autoRenew,
        },
      })
    : await prisma.sslCertificate.create({
        data: {
          domainId: subdomain.domainId,
          subdomainId: subdomain.id,
          status: "PENDING",
          autoRenew: input.autoRenew ?? true,
        },
      });

  const agentResult = await callAgent(
    {
      action: "issue_ssl",
      domain: hostname,
      subdomains: [],
      documentRoot: subdomain.documentRoot,
    },
    agentKey
  );

  return finalizeSslCertificate(cert.id, agentResult);
}

export async function renewSslCertificate(certId: string, userId: string) {
  const cert = await prisma.sslCertificate.findFirstOrThrow({
    where: { id: certId, domain: { userId } },
    include: {
      domain: { include: { server: true } },
      subdomain: { select: { name: true } },
    },
  });

  await prisma.sslCertificate.update({
    where: { id: cert.id },
    data: { status: "PENDING", lastError: null },
  });

  const hostname = getCertificateHostname(cert);
  const agentResult = await callAgent(
    { action: "renew_ssl", domain: hostname },
    cert.domain.server.agentKey || getAgentApiKey()
  );

  const status: SslStatus = agentResult.success ? "ACTIVE" : "FAILED";
  const data = agentResult.data as
    | { issuedAt?: string; expiresAt?: string }
    | undefined;

  return prisma.sslCertificate.update({
    where: { id: cert.id },
    data: {
      status,
      issuedAt: data?.issuedAt ? new Date(data.issuedAt) : cert.issuedAt,
      expiresAt: data?.expiresAt ? new Date(data.expiresAt) : cert.expiresAt,
      lastError: agentResult.success ? null : agentResult.error,
    },
    include: {
      domain: { select: { name: true, id: true } },
      subdomain: { select: { name: true, id: true } },
    },
  });
}

export function getSslHostname(cert: {
  domain: { name: string };
  subdomain?: { name: string } | null;
}) {
  return getCertificateHostname(cert);
}
