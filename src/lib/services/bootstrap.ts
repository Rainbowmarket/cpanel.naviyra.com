import { prisma } from "@/lib/prisma";
import { getAgentApiKey, getDefaultDocumentRoot, getServerPublicIp } from "@/lib/paths";
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

function panelHostnames(): Set<string> {
  const hosts = new Set<string>();
  const publicUrl = process.env.PANEL_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      hosts.add(new URL(publicUrl).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  hosts.add("naviyra.uk");
  hosts.add("www.naviyra.uk");
  return hosts;
}

/**
 * On first admin registration:
 * - create/update Primary Server as server1.{domain}
 * - register the domain in the panel (skip nginx overwrite if it is the panel host)
 */
export async function bootstrapMainServer(input: {
  userId: string;
  domainName: string;
}) {
  const domain = normalizeDomainName(input.domainName);
  if (!isValidDomainName(domain)) {
    throw new Error("Invalid domain name");
  }

  const hostname = `server1.${domain}`;
  const ipAddress = getServerPublicIp();
  const agentKey = getAgentApiKey();

  let server = await prisma.server.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (server) {
    // Hostname is unique — clear conflict if another row already owns the new name
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

  const isPanelHost = panelHostnames().has(domain);
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
  } else if (isPanelHost) {
    // Panel already serves this hostname — register in DB only, do not rewrite nginx.
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
