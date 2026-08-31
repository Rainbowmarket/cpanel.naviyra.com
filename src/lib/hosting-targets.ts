import { prisma } from "@/lib/prisma";
import { mailHostLabel } from "@/lib/dns/zone";
import { getMailHostname } from "@/lib/paths";
import type { PanelPermissionKey } from "@/lib/panel-permissions";

export type HostingTarget = {
  id: string;
  label: string;
  documentRoot: string;
  domainId: string;
  kind: "domain" | "subdomain";
  serverId?: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
};

export type AccessActor = {
  id: string;
  role: "ADMIN" | "USER";
};

export function parseHostingTargetId(
  target: string
): { kind: "domain" | "subdomain"; id: string } {
  if (target.startsWith("s:")) {
    return { kind: "subdomain", id: target.slice(2) };
  }
  if (target.startsWith("d:")) {
    return { kind: "domain", id: target.slice(2) };
  }
  return { kind: "domain", id: target };
}

export function isMailSubdomainName(
  subdomainName: string,
  domainName: string
): boolean {
  const mailLabel = mailHostLabel(getMailHostname(domainName), domainName);
  return mailLabel !== null && mailLabel !== "@" && subdomainName === mailLabel;
}

export function toAccessActor(actor: AccessActor | string): AccessActor {
  if (typeof actor === "string") return { id: actor, role: "USER" };
  return actor;
}

/**
 * Domain visibility / scope filter.
 * - ADMIN: all domains
 * - Owner (Domain.userId): all features on that domain
 * - Grantee: domain appears if they have any grant; with `feature`, only if that key is granted
 * Never changes Domain.userId; grants are DomainAccess rows only.
 */
export function domainAccessWhere(
  actor: AccessActor | string,
  feature?: PanelPermissionKey
): Record<string, unknown> {
  const a = toAccessActor(actor);
  if (a.role === "ADMIN") return {};
  if (!feature) {
    return {
      OR: [{ userId: a.id }, { accessGrants: { some: { userId: a.id } } }],
    };
  }
  return {
    OR: [
      { userId: a.id },
      {
        accessGrants: {
          some: {
            userId: a.id,
            permissions: { some: { key: feature } },
          },
        },
      },
    ],
  };
}

/** Merge grant/owner filter with optional panel apex visibility (admin create paths only). */
export function domainAccessWhereOrPanel(
  actor: AccessActor | string,
  feature: PanelPermissionKey,
  panelBase?: string | null
): Record<string, unknown> {
  const access = domainAccessWhere(actor, feature);
  // Do not use this for user-facing lists — it leaks panel infra to every account.
  if (!panelBase || Object.keys(access).length === 0) return access;
  const ors = Array.isArray(access.OR) ? access.OR : [access];
  return { OR: [...ors, { name: panelBase }] };
}

/** Throw if actor cannot use `feature` on this domain. */
export async function assertDomainFeature(
  actor: AccessActor | string,
  domainId: string,
  feature: PanelPermissionKey
) {
  const a = toAccessActor(actor);
  if (a.role === "ADMIN") return;
  const domain = await prisma.domain.findFirst({
    where: { id: domainId, ...domainAccessWhere(a, feature) },
    select: { id: true },
  });
  if (!domain) {
    throw new Error("Forbidden: no permission for this domain feature");
  }
}

export async function listHostingTargets(
  actor: AccessActor | string,
  options?: {
    excludeMailSubdomains?: boolean;
    feature?: PanelPermissionKey;
  }
): Promise<HostingTarget[]> {
  const excludeMail = options?.excludeMailSubdomains ?? false;
  const access = domainAccessWhere(actor, options?.feature);
  const asAdmin = toAccessActor(actor).role === "ADMIN";

  const domains = await prisma.domain.findMany({
    where: access,
    orderBy: { name: "asc" },
    include: {
      user: { select: { email: true, name: true } },
    },
  });
  const subdomains = await prisma.subdomain.findMany({
    where: { domain: access },
    include: {
      domain: {
        select: {
          name: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
    orderBy: [{ domain: { name: "asc" } }, { name: "asc" }],
  });

  const targets: HostingTarget[] = [];

  for (const domain of domains) {
    targets.push({
      id: `d:${domain.id}`,
      label: domain.name,
      documentRoot: domain.documentRoot,
      domainId: domain.id,
      serverId: domain.serverId,
      kind: "domain",
      ownerEmail: asAdmin ? domain.user.email : null,
      ownerName: asAdmin ? domain.user.name : null,
    });
    for (const subdomain of subdomains.filter((s) => s.domainId === domain.id)) {
      if (
        excludeMail &&
        isMailSubdomainName(subdomain.name, subdomain.domain.name)
      ) {
        continue;
      }
      targets.push({
        id: `s:${subdomain.id}`,
        label: `${subdomain.name}.${subdomain.domain.name}`,
        documentRoot: subdomain.documentRoot,
        domainId: domain.id,
        serverId: domain.serverId,
        kind: "subdomain",
        ownerEmail: asAdmin ? subdomain.domain.user.email : null,
        ownerName: asAdmin ? subdomain.domain.user.name : null,
      });
    }
  }

  return targets;
}

export async function resolveHostingTarget(
  target: string,
  actor: AccessActor | string,
  options?: {
    excludeMailSubdomains?: boolean;
    feature?: PanelPermissionKey;
  }
): Promise<HostingTarget> {
  const parsed = parseHostingTargetId(target);
  const targets = await listHostingTargets(actor, options);
  const match = targets.find((t) =>
    parsed.kind === "subdomain"
      ? t.id === `s:${parsed.id}`
      : t.kind === "domain" &&
        (t.id === `d:${parsed.id}` || t.domainId === parsed.id)
  );
  if (!match) {
    throw new Error("Invalid hosting target");
  }
  return match;
}
