import { prisma } from "@/lib/prisma";
import { persistPanelBaseDomainFromLogin } from "@/lib/base-domain";
import { getAgentApiKey, getDefaultDocumentRoot, getServerPublicIp } from "@/lib/paths";
import { isPanelHostname } from "@/lib/panel-host";
import { createDomain } from "@/lib/services/domains";

/** Normalize user-entered domain to apex hostname. */
export function normalizeDomainName(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0] ?? value;
  value = value.split(":")[0] ?? value;
  value = value.replace(/^www\./, "");
  return value;
}

const DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function isValidDomainName(domain: string): boolean {
  return DOMAIN_RE.test(domain) && domain.length <= 253;
}

/**
 * On first admin registration:
 * - persist PANEL_HOSTNAME / DNS_NS* / etc. from the entered main domain
 * - create/update Primary Server as server1.{domain}
 * - register the domain in DB without overwriting the panel nginx vhost
 */
export async function bootstrapMainServer(input: {
  userId: string;
  domainName: string;
}) {
  const domain = normalizeDomainName(input.domainName);
  if (!isValidDomainName(domain)) {
    throw new Error("Invalid domain name");
  }

  // First-login domain becomes the panel base domain in .env
  persistPanelBaseDomainFromLogin(domain);

  const hostname = `server1.${domain}`;
  const ipAddress = getServerPublicIp();
  const agentKey = getAgentApiKey();

  let server = await prisma.server.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (server) {
    const clash = await prisma.server.findUnique({ where: { hostname } });
    if (clash && clash.id !== server.id) {
      await prisma.server.delete({ where: { id: clash.id } });
    }
    server = await prisma.server.update({
      where: { id: server.id },
      data: {
        name: "Primary Server",
        hostname,
        ipAddress,
        agentKey,
        isActive: true,
      },
    });
  } else {
    server = await prisma.server.create({
      data: {
        name: "Primary Server",
        hostname,
        ipAddress,
        agentKey,
        isActive: true,
      },
    });
  }

  // Main login domain is always the panel host after persist — DB only, no nginx overwrite.
  const existingDomain = await prisma.domain.findUnique({
    where: { name: domain },
  });

  if (existingDomain) {
    await prisma.domain.update({
      where: { id: existingDomain.id },
      data: {
        userId: input.userId,
        serverId: server.id,
        status: "ACTIVE",
        lastError: null,
        documentRoot: getDefaultDocumentRoot(domain),
      },
    });
  } else if (isPanelHostname(domain)) {
    await prisma.domain.create({
      data: {
        name: domain,
        documentRoot: getDefaultDocumentRoot(domain),
        phpEnabled: true,
        userId: input.userId,
        serverId: server.id,
        status: "ACTIVE",
      },
    });
  } else {
    // Fallback if env persist failed for some reason
    await createDomain({
      userId: input.userId,
      serverId: server.id,
      name: domain,
      phpEnabled: true,
    });
  }

  return {
    server: { id: server.id, hostname: server.hostname, ipAddress: server.ipAddress },
    domain,
  };
}
