import { prisma } from "@/lib/prisma";
import { mailHostLabel } from "@/lib/dns/zone";
import { getMailHostname } from "@/lib/paths";

export type HostingTarget = {
  id: string;
  label: string;
  documentRoot: string;
  domainId: string;
  kind: "domain" | "subdomain";
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

export async function listHostingTargets(
  userId: string,
  options?: { excludeMailSubdomains?: boolean }
): Promise<HostingTarget[]> {
  const excludeMail = options?.excludeMailSubdomains ?? false;

  const domains = await prisma.domain.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
  const subdomains = await prisma.subdomain.findMany({
    where: { domain: { userId } },
    include: { domain: { select: { name: true } } },
    orderBy: [{ domain: { name: "asc" } }, { name: "asc" }],
  });

  const targets: HostingTarget[] = [];

  for (const domain of domains) {
    targets.push({
      id: `d:${domain.id}`,
      label: domain.name,
      documentRoot: domain.documentRoot,
      domainId: domain.id,
      kind: "domain",
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
        kind: "subdomain",
      });
    }
  }

  return targets;
}

export async function resolveHostingTarget(
  target: string,
  userId: string,
  options?: { excludeMailSubdomains?: boolean }
): Promise<HostingTarget> {
  const parsed = parseHostingTargetId(target);
  const targets = await listHostingTargets(userId, options);
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
