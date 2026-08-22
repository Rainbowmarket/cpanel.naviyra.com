import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId } from "@/lib/agent/target";
import { isPanelHostname, isReservedPanelSubdomain } from "@/lib/panel-host";
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

/**
 * Panel hostname already has nginx → panel proxy. Issue/renew cert via certbot
 * without replacing that vhost, and sync the row into the panel DB.
 */
async function syncOrIssuePanelSsl(opts: {
  domain: {
    id: string;
    name: string;
    documentRoot: string;
    phpEnabled: boolean;
    appType: string;
    upstreamPort: number | null;
    serverId: string;
    server: { agentKey: string | null };
  };
  userId: string;
  includeWww?: boolean;
  autoRenew?: boolean;
  /** If true, only read existing cert dates (no certbot). */
  infoOnly?: boolean;
}) {
  await dedupeSslCertificates(opts.userId);
  const target = await agentTargetForServerId(opts.domain.serverId);
  const existing = await prisma.sslCertificate.findFirst({
    where: { domainId: opts.domain.id, subdomainId: null },
    orderBy: { createdAt: "desc" },
  });

  const cert = existing
    ? await prisma.sslCertificate.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          lastError: null,
          autoRenew: opts.autoRenew ?? existing.autoRenew,
        },
      })
    : await prisma.sslCertificate.create({
        data: {
          domainId: opts.domain.id,
          status: "PENDING",
          autoRenew: opts.autoRenew ?? true,
        },
      });

  if (opts.infoOnly) {
    const info = await callAgent<{
      exists?: boolean;
      issuedAt?: string | null;
      expiresAt?: string | null;
    }>({ action: "ssl_cert_info", domain: opts.domain.name }, target);

    if (info.success && info.data?.exists) {
      return prisma.sslCertificate.update({
        where: { id: cert.id },
        data: {
          status: "ACTIVE",
          issuedAt: info.data.issuedAt ? new Date(info.data.issuedAt) : null,
          expiresAt: info.data.expiresAt ? new Date(info.data.expiresAt) : null,
          lastError: null,
        },
        include: {
          domain: { select: { name: true, id: true } },
          subdomain: { select: { name: true, id: true } },
        },
      });
    }

    return prisma.sslCertificate.update({
      where: { id: cert.id },
      data: {
        status: "FAILED",
        lastError:
          info.error ??
          "No Let's Encrypt certificate found for the panel hostname yet.",
      },
      include: {
        domain: { select: { name: true, id: true } },
        subdomain: { select: { name: true, id: true } },
      },
    });
  }

  const subdomains = opts.includeWww !== false ? ["www"] : [];
  const agentResult = await callAgent(
    {
      action: "issue_ssl",
      domain: opts.domain.name,
      subdomains,
      documentRoot: opts.domain.documentRoot,
      phpEnabled: false,
      appType: "STATIC",
      upstreamPort: null,
    },
    target
  );

  return finalizeSslCertificate(cert.id, agentResult);
}

/** If panel apex has a live cert on disk but no ACTIVE DB row, sync it. */
export async function ensurePanelSslSynced(userId?: string) {
  const domains = await prisma.domain.findMany({
    where: userId ? { userId } : undefined,
    include: { server: true },
  });
  for (const domain of domains) {
    if (!isPanelHostname(domain.name)) continue;
    const existing = await prisma.sslCertificate.findFirst({
      where: { domainId: domain.id, subdomainId: null },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.status === "ACTIVE") continue;
    try {
      await syncOrIssuePanelSsl({
        domain,
        userId: domain.userId ?? userId ?? "",
        includeWww: true,
        infoOnly: true,
      });
    } catch (error) {
      console.error("ensurePanelSslSynced failed:", error);
    }
  }
}

export async function listSslCertificates(userId: string, role?: string) {
  await dedupeSslCertificates(role === "ADMIN" ? undefined : userId);
  await ensurePanelSslSynced(userId);

  const certificates = await prisma.sslCertificate.findMany({
    where: role === "ADMIN" ? undefined : { domain: { userId } },
    include: {
      domain: { select: { name: true, id: true } },
      subdomain: { select: { name: true, id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return certificates.map((cert) => ({
    ...cert,
    reserved: cert.subdomain
      ? isReservedPanelSubdomain(cert.subdomain.name, cert.domain.name)
      : isPanelHostname(cert.domain.name),
  }));
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

  if (isPanelHostname(domain.name)) {
    // Panel apex SSL: renew/sync cert only — never rewrite the panel nginx vhost.
    return syncOrIssuePanelSsl({
      domain,
      userId: input.userId,
      includeWww: input.includeWww,
      autoRenew: input.autoRenew,
    });
  }

  await dedupeSslCertificates(input.userId);

  const existing = await prisma.sslCertificate.findFirst({
    where: { domainId: domain.id, subdomainId: null },
    orderBy: { createdAt: "desc" },
  });

  const subdomains = input.includeWww !== false ? ["www"] : [];
  const target = await agentTargetForServerId(domain.serverId);

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
      phpEnabled: domain.phpEnabled,
      appType: domain.appType,
      upstreamPort: domain.upstreamPort,
    },
    target
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
  const target = await agentTargetForServerId(subdomain.domain.serverId);

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
      phpEnabled: subdomain.appType === "PHP",
      appType: subdomain.appType,
      upstreamPort: subdomain.upstreamPort,
    },
    target
  );

  return finalizeSslCertificate(cert.id, agentResult);
}

export async function renewSslCertificate(certId: string, userId: string) {
  const cert = await prisma.sslCertificate.findFirstOrThrow({
    where: { id: certId, domain: { userId } },
    include: {
      domain: { include: { server: true } },
      subdomain: true,
    },
  });

  if (!cert.subdomain && isPanelHostname(cert.domain.name)) {
    return syncOrIssuePanelSsl({
      domain: cert.domain,
      userId,
      includeWww: true,
      autoRenew: cert.autoRenew,
    });
  }

  await prisma.sslCertificate.update({
    where: { id: cert.id },
    data: { status: "PENDING", lastError: null },
  });

  const hostname = getCertificateHostname(cert);
  const appType = cert.subdomain?.appType ?? cert.domain.appType;
  const upstreamPort = cert.subdomain?.upstreamPort ?? cert.domain.upstreamPort;
  const agentResult = await callAgent(
    {
      action: "renew_ssl",
      domain: hostname,
      documentRoot: cert.subdomain?.documentRoot ?? cert.domain.documentRoot,
      phpEnabled: appType === "PHP",
      appType,
      upstreamPort,
    },
    await agentTargetForServerId(cert.domain.serverId)
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
