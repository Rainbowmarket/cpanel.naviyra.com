import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getDnsZoneApex } from "@/lib/base-domain";
import { assertAllowedPanelSubdomainLabel, isReservedPanelSubdomain } from "@/lib/panel-host";
import { mailHostLabel } from "@/lib/dns/zone";
import {
  getDefaultSubdomainRoot,
  getMailHostname,
  resolveAllowedDocumentRoot,
} from "@/lib/paths";
import { agentTargetForServerId } from "@/lib/agent/target";
import { assertValidSubdomainLabels } from "@/lib/hostname";
import { ensurePanelBaseDomain } from "@/lib/services/domains";
import { addSubdomainDnsRecord, removeSubdomainDnsRecord } from "@/lib/services/dns";
import { phpEnabledForAppType, removeSiteAppUnit } from "@/lib/services/apps";
import type { AppType, DomainStatus } from "@/generated/prisma/client";

/** Normalize subdomain label (supports nested: api.v1). */
export function normalizeSubdomainName(raw: string): string {
  let name = raw.trim().toLowerCase();
  name = name.replace(/^https?:\/\//, "");
  name = name.split("/")[0] ?? name;
  name = name.replace(/\.$/, "");
  return name;
}

export function assertValidSubdomainLabel(name: string) {
  assertValidSubdomainLabels(name);
}

/**
 * Parse a full hostname into parent domain + subdomain label.
 * Example: api.shop.example.com + domains[example.com] → { name: "api.shop", domainId }
 */
export function parseCustomSubdomainFqdn(
  fqdnRaw: string,
  domains: Array<{ id: string; name: string }>
): { domainId: string; name: string; domainName: string } {
  let fqdn = normalizeSubdomainName(fqdnRaw);
  if (!fqdn.includes(".")) {
    throw new Error("Enter a full hostname like blog.example.com");
  }

  const sorted = [...domains].sort((a, b) => b.name.length - a.name.length);
  for (const d of sorted) {
    const parent = d.name.toLowerCase();
    if (fqdn === parent) {
      throw new Error("That is the main domain. Use Domains to manage it.");
    }
    if (fqdn.endsWith(`.${parent}`)) {
      const label = fqdn.slice(0, -(parent.length + 1));
      assertValidSubdomainLabel(label);
      assertAllowedPanelSubdomainLabel(label, parent);
      return { domainId: d.id, name: label, domainName: parent };
    }
  }

  const panelBase = getDnsZoneApex();
  const owned = domains.map((d) => d.name).filter(Boolean);
  const hint =
    owned.length > 0
      ? ` Your domains: ${owned.join(", ")}.`
      : panelBase
        ? ` Panel subdomains like block.${panelBase} are allowed for admins.`
        : "";
  throw new Error(
    `Hostname must end with one of your domains (e.g. blog.yourdomain.com).${hint}`
  );
}

/** Resolve a custom FQDN for the current user (ensures panel apex for admins). */
export async function resolveCustomSubdomainFqdn(
  fqdnRaw: string,
  userId: string,
  role: "ADMIN" | "USER"
): Promise<{ domainId: string; name: string; domainName: string }> {
  const fqdn = normalizeSubdomainName(fqdnRaw);
  const panelBase = getDnsZoneApex();

  if (role === "ADMIN" && panelBase && fqdn.endsWith(`.${panelBase}`) && fqdn !== panelBase) {
    await ensurePanelBaseDomain(userId);
  }

  const domains =
    role === "ADMIN" && panelBase
      ? await prisma.domain.findMany({
          where: { OR: [{ userId }, { name: panelBase }] },
          select: { id: true, name: true },
        })
      : await prisma.domain.findMany({
          where: { userId },
          select: { id: true, name: true },
        });

  return parseCustomSubdomainFqdn(fqdn, domains);
}

const subdomainListInclude = {
  domain: { select: { name: true, appType: true, phpEnabled: true, id: true } },
  sslCerts: { orderBy: { createdAt: "desc" as const }, take: 1 },
};

/** Recreate mail.* / webmail.* panel rows so reserved hosts stay visible for SSL. */
async function ensureMissingMailSubdomains() {
  const domains = await prisma.domain.findMany({
    select: { id: true, name: true, userId: true },
  });
  for (const domain of domains) {
    const mailLabel = mailHostLabel(getMailHostname(domain.name), domain.name);
    if (!mailLabel || mailLabel === "@") continue;
    const existing = await prisma.subdomain.findFirst({
      where: { domainId: domain.id, name: mailLabel },
      select: { id: true },
    });
    if (existing) continue;
    try {
      await createSubdomain({
        domainId: domain.id,
        userId: domain.userId,
        name: mailLabel,
        appType: "STATIC",
        allowMailHost: true,
        allowPanelDomain: true,
      });
    } catch (error) {
      console.error(
        `Failed to restore reserved mail host ${mailLabel}.${domain.name}:`,
        error
      );
    }
  }
}

export async function listSubdomains(
  domainId: string,
  userId: string,
  opts?: { role?: "ADMIN" | "USER" }
) {
  if (opts?.role === "ADMIN") {
    await ensureMissingMailSubdomains().catch(() => undefined);
    return prisma.subdomain.findMany({
      where: { domainId },
      include: subdomainListInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  const panelBase = getDnsZoneApex();
  return prisma.subdomain.findMany({
    where: {
      domainId,
      domain: {
        OR: [
          { userId },
          ...(panelBase ? [{ name: panelBase }] : []),
        ],
      },
    },
    include: subdomainListInclude,
    orderBy: { createdAt: "desc" },
  });
}

/** All subdomains for the user (admins see every domain, including reserved mail hosts). */
export async function listAllSubdomains(
  userId: string,
  opts?: { role?: "ADMIN" | "USER" }
) {
  if (opts?.role === "ADMIN") {
    await ensureMissingMailSubdomains().catch(() => undefined);
    return prisma.subdomain.findMany({
      include: subdomainListInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  const panelBase = getDnsZoneApex();
  return prisma.subdomain.findMany({
    where: {
      domain: {
        OR: [
          { userId },
          ...(panelBase ? [{ name: panelBase }] : []),
        ],
      },
    },
    include: subdomainListInclude,
    orderBy: { createdAt: "desc" },
  });
}

async function provisionSubdomain(subdomain: {
  id: string;
  name: string;
  documentRoot: string;
  appType: AppType;
  upstreamPort: number | null;
  domain: { name: string; phpEnabled: boolean; serverId: string };
}) {
  const agentResult = await callAgent(
    {
      action: "create_subdomain",
      domain: subdomain.domain.name,
      subdomain: subdomain.name,
      documentRoot: subdomain.documentRoot,
      phpEnabled: phpEnabledForAppType(subdomain.appType),
      appType: subdomain.appType,
      upstreamPort: subdomain.upstreamPort,
    },
    await agentTargetForServerId(subdomain.domain.serverId)
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
  appType?: AppType;
  /** When true, allow creating under the panel base domain even if owned by another admin. */
  allowPanelDomain?: boolean;
  /** When true, allow reserved mail/webmail label on the panel apex (mail host setup). */
  allowMailHost?: boolean;
}) {
  const panelBase = getDnsZoneApex();
  const domain = await prisma.domain.findFirst({
    where: {
      id: input.domainId,
      OR: [
        { userId: input.userId },
        ...(input.allowPanelDomain && panelBase
          ? [{ name: panelBase }]
          : []),
      ],
    },
    include: { server: true },
  });
  if (!domain) {
    throw new Error("Domain not found");
  }

  const name = normalizeSubdomainName(input.name);
  // Allow pasting full FQDN in the name field
  let label = name;
  if (name === domain.name) {
    throw new Error("That is the main domain, not a subdomain.");
  }
  if (name.endsWith(`.${domain.name}`)) {
    label = name.slice(0, -(domain.name.length + 1));
  }
  assertValidSubdomainLabel(label);
  assertAllowedPanelSubdomainLabel(label, domain.name, {
    allowMailHost: input.allowMailHost,
  });

  const existing = await prisma.subdomain.findFirst({
    where: { domainId: domain.id, name: label },
  });
  if (existing) {
    throw new Error(
      `Subdomain "${label}.${domain.name}" already exists. Delete it first or choose another name.`
    );
  }

  const documentRoot = input.documentRoot?.trim()
    ? resolveAllowedDocumentRoot(input.documentRoot.trim())
    : getDefaultSubdomainRoot(domain.name, label);

  const appType: AppType = input.appType ?? domain.appType;

  const subdomain = await prisma.subdomain.create({
    data: {
      name: label,
      documentRoot,
      domainId: domain.id,
      appType,
      status: "PENDING",
    },
  });

  return provisionSubdomain({
    id: subdomain.id,
    name: subdomain.name,
    documentRoot: subdomain.documentRoot,
    appType: subdomain.appType,
    upstreamPort: subdomain.upstreamPort,
    domain: {
      name: domain.name,
      phpEnabled: domain.phpEnabled,
      serverId: domain.serverId,
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
    appType: subdomain.appType,
    upstreamPort: subdomain.upstreamPort,
    domain: {
      name: subdomain.domain.name,
      phpEnabled: subdomain.domain.phpEnabled,
      serverId: subdomain.domain.serverId,
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

  if (isReservedPanelSubdomain(subdomain.name, subdomain.domain.name)) {
    throw new Error(
      "This hostname is reserved for panel infrastructure and cannot be edited"
    );
  }

  const safeRoot = resolveAllowedDocumentRoot(documentRoot);

  await prisma.subdomain.update({
    where: { id: subdomain.id },
    data: { documentRoot: safeRoot, status: "PENDING", lastError: null },
  });

  const agentResult = await callAgent(
    {
      action: "create_directory",
      path: safeRoot,
    },
    await agentTargetForServerId(subdomain.domain.serverId)
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

  if (isReservedPanelSubdomain(subdomain.name, subdomain.domain.name)) {
    throw new Error(
      "This hostname is reserved for panel infrastructure and cannot be deleted"
    );
  }

  const domainId = subdomain.domainId;
  const subdomainName = subdomain.name;

  await removeSiteAppUnit("subdomain", subdomain.id, userId).catch(() => undefined);

  await callAgent(
    {
      action: "delete_subdomain",
      domain: subdomain.domain.name,
      subdomain: subdomain.name,
      documentRoot: subdomain.documentRoot,
      deleteFiles,
    },
    await agentTargetForServerId(subdomain.domain.serverId)
  );

  // Delete DB row before DNS sync — syncDnsZone re-upserts A records for
  // every remaining subdomain; if this row still exists, the record comes back.
  await prisma.subdomain.delete({ where: { id: subdomain.id } });

  try {
    await removeSubdomainDnsRecord(domainId, subdomainName);
  } catch (error) {
    console.error("Subdomain DNS record removal failed:", error);
  }

  return { id: subdomainId, domainId, name: subdomainName };
}
