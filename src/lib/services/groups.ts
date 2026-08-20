import { prisma } from "@/lib/prisma";
import { sanitizePermissionKeys } from "@/lib/panel-permissions";

const groupInclude = {
  permissions: { select: { key: true } },
  members: {
    select: {
      userId: true,
      user: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  },
} as const;

type GroupRecord = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  permissions: { key: string }[];
  members: {
    userId: string;
    user: { id: string; name: string; email: string; role: string };
  }[];
};

function serializeGroup(group: GroupRecord) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: group.createdAt,
    permissionKeys: group.permissions.map((grant) => grant.key),
    members: group.members.map((member) => member.user),
  };
}

export async function listGroups() {
  const groups = await prisma.panelGroup.findMany({
    orderBy: { name: "asc" },
    include: groupInclude,
  });
  return groups.map(serializeGroup);
}

export async function listAssignableUsers() {
  return prisma.user.findMany({
    where: { role: { not: "ADMIN" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });
}

async function assertUsersExist(userIds: string[]) {
  if (userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, role: true },
  });
  if (users.length !== userIds.length) {
    throw new Error("One or more users were not found");
  }
  if (users.some((user) => user.role === "ADMIN")) {
    throw new Error("Admin accounts cannot be added to permission groups");
  }
}

export async function createGroup(input: {
  name: string;
  description?: string;
  permissionKeys: string[];
  userIds: string[];
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Group name is required");

  const existing = await prisma.panelGroup.findUnique({ where: { name } });
  if (existing) throw new Error("Group name already in use");

  const permissionKeys = sanitizePermissionKeys(input.permissionKeys);
  const userIds = [...new Set(input.userIds)];
  await assertUsersExist(userIds);

  const group = await prisma.panelGroup.create({
    data: {
      name,
      description: input.description?.trim() || null,
      permissions: {
        create: permissionKeys.map((key) => ({ key })),
      },
      members: {
        create: userIds.map((userId) => ({ userId })),
      },
    },
    include: groupInclude,
  });

  return serializeGroup(group);
}

export async function updateGroup(input: {
  id: string;
  name: string;
  description?: string;
  permissionKeys: string[];
  userIds: string[];
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Group name is required");

  const clash = await prisma.panelGroup.findFirst({
    where: { name, id: { not: input.id } },
  });
  if (clash) throw new Error("Group name already in use");

  const permissionKeys = sanitizePermissionKeys(input.permissionKeys);
  const userIds = [...new Set(input.userIds)];
  await assertUsersExist(userIds);

  await prisma.$transaction([
    prisma.panelGroup.update({
      where: { id: input.id },
      data: {
        name,
        description: input.description?.trim() || null,
      },
    }),
    prisma.panelGroupPermission.deleteMany({ where: { groupId: input.id } }),
    prisma.panelGroupMember.deleteMany({ where: { groupId: input.id } }),
    ...permissionKeys.map((key) =>
      prisma.panelGroupPermission.create({
        data: { groupId: input.id, key },
      })
    ),
    ...userIds.map((userId) =>
      prisma.panelGroupMember.create({
        data: { groupId: input.id, userId },
      })
    ),
  ]);

  const group = await prisma.panelGroup.findUniqueOrThrow({
    where: { id: input.id },
    include: groupInclude,
  });
  return serializeGroup(group);
}

export async function deleteGroup(id: string) {
  await prisma.panelGroup.delete({ where: { id } });
}
