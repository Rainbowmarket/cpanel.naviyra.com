import { prisma } from "@/lib/prisma";
import {
  isPanelPermissionKey,
  type PanelPermissionKey,
  PANEL_PERMISSION_CATALOG,
} from "@/lib/panel-permissions";

/** Per-domain grant keys — same catalog as groups, without global `admin`. */
export const DOMAIN_GRANT_PERMISSION_KEYS = PANEL_PERMISSION_CATALOG.map(
  (item) => item.key
).filter((key) => key !== "admin") as Exclude<PanelPermissionKey, "admin">[];

export function sanitizeDomainGrantKeys(keys: string[]): PanelPermissionKey[] {
  return [
    ...new Set(
      keys.filter(
        (key): key is PanelPermissionKey =>
          isPanelPermissionKey(key) && key !== "admin"
      )
    ),
  ];
}

function serializeGrant(row: {
  id: string;
  domainId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  domain: { id: string; name: string };
  user: { id: string; name: string; email: string; role: string };
  permissions: Array<{ key: string }>;
}) {
  return {
    id: row.id,
    domainId: row.domainId,
    userId: row.userId,
    domain: row.domain,
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.user.role,
    },
    permissions: row.permissions.map((p) => p.key).sort(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const grantInclude = {
  domain: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true, role: true } },
  permissions: { select: { key: true } },
} as const;

export async function listDomainAccessGrants(opts?: {
  domainId?: string;
  userId?: string;
}) {
  const rows = await prisma.domainAccess.findMany({
    where: {
      ...(opts?.domainId ? { domainId: opts.domainId } : {}),
      ...(opts?.userId ? { userId: opts.userId } : {}),
    },
    include: grantInclude,
    orderBy: [{ updatedAt: "desc" }],
  });
  return rows.map(serializeGrant);
}

export async function listDomainAccessFormOptions() {
  const [domains, users] = await Promise.all([
    prisma.domain.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: "USER" },
      orderBy: { email: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
  ]);
  return {
    domains,
    users,
    permissionKeys: DOMAIN_GRANT_PERMISSION_KEYS,
    permissionCatalog: PANEL_PERMISSION_CATALOG.filter((p) => p.key !== "admin"),
  };
}

/**
 * Upsert grant for an existing domain → user.
 * Does not create domains or change Domain.userId.
 */
export async function upsertDomainAccess(input: {
  domainId: string;
  userId: string;
  permissions: string[];
}) {
  const permissions = sanitizeDomainGrantKeys(input.permissions);
  if (permissions.length === 0) {
    throw new Error("Select at least one permission");
  }

  const domain = await prisma.domain.findUnique({
    where: { id: input.domainId },
    select: { id: true, name: true, userId: true },
  });
  if (!domain) throw new Error("Domain not found");

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, email: true },
  });
  if (!user) throw new Error("User not found");
  if (user.role === "ADMIN") {
    throw new Error("Administrators already have full access; grants are for regular users only");
  }
  if (user.id === domain.userId) {
    throw new Error(
      "This user already owns the domain; ownership grants full access without a grant row"
    );
  }

  const existing = await prisma.domainAccess.findUnique({
    where: {
      domainId_userId: { domainId: input.domainId, userId: input.userId },
    },
  });

  const row = existing
    ? await prisma.$transaction(async (tx) => {
        await tx.domainAccessPermission.deleteMany({
          where: { accessId: existing.id },
        });
        return tx.domainAccess.update({
          where: { id: existing.id },
          data: {
            permissions: {
              create: permissions.map((key) => ({ key })),
            },
          },
          include: grantInclude,
        });
      })
    : await prisma.domainAccess.create({
        data: {
          domainId: input.domainId,
          userId: input.userId,
          permissions: {
            create: permissions.map((key) => ({ key })),
          },
        },
        include: grantInclude,
      });

  return serializeGrant(row);
}

export async function updateDomainAccess(
  id: string,
  permissions: string[]
) {
  const keys = sanitizeDomainGrantKeys(permissions);
  if (keys.length === 0) {
    throw new Error("Select at least one permission");
  }
  const existing = await prisma.domainAccess.findUnique({ where: { id } });
  if (!existing) throw new Error("Grant not found");

  const row = await prisma.$transaction(async (tx) => {
    await tx.domainAccessPermission.deleteMany({ where: { accessId: id } });
    return tx.domainAccess.update({
      where: { id },
      data: {
        permissions: { create: keys.map((key) => ({ key })) },
      },
      include: grantInclude,
    });
  });
  return serializeGrant(row);
}

export async function deleteDomainAccess(id: string) {
  const existing = await prisma.domainAccess.findUnique({ where: { id } });
  if (!existing) throw new Error("Grant not found");
  await prisma.domainAccess.delete({ where: { id } });
  return { ok: true };
}
