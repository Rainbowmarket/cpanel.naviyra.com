import { prisma } from "@/lib/prisma";
import { persistPanelBaseDomainFromLogin, getPanelHostname, getDnsZoneApex } from "@/lib/base-domain";
import { getAgentApiKey, getDefaultServerHostname, getServerPublicIp } from "@/lib/paths";
import { assertValidHostname, normalizeHostnameInput } from "@/lib/hostname";
import { ensurePanelBaseDomain } from "@/lib/services/domains";

/** Normalize user-entered domain to apex hostname. */
export function normalizeDomainName(input: string): string {
  return normalizeHostnameInput(input);
}

export function isValidDomainName(domain: string): boolean {
  try {
    assertValidHostname(domain);
    return true;
  } catch {
    return false;
  }
}

/**
 * On first admin registration:
 * - use PANEL_HOSTNAME from install (.env) when set; otherwise persist from the form
 * - create/update Primary Server from DEFAULT_SERVER_HOSTNAME (s1.{zone apex})
 * - register the DNS/marketing apex in DB (not the panel host vhost)
 */
export async function bootstrapMainServer(input: {
  userId: string;
  domainName: string;
}) {
  const installed = getPanelHostname();
  if (!installed) {
    persistPanelBaseDomainFromLogin(input.domainName);
  }

  const zone = getDnsZoneApex() || normalizeDomainName(installed || input.domainName);
  if (!isValidDomainName(zone)) {
    throw new Error("Invalid domain name");
  }

  const hostname = getDefaultServerHostname();
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

  await ensurePanelBaseDomain(input.userId);

  return {
    server: { id: server.id, hostname: server.hostname, ipAddress: server.ipAddress },
    domain: zone,
  };
}
