import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      _count: { select: { domains: true } },
    },
  });
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role?: "ADMIN" | "RESELLER" | "USER";
}) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw new Error("Email already in use");
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role ?? "USER",
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });
}

export async function deleteUser(userId: string, currentUserId: string) {
  if (userId === currentUserId) {
    throw new Error("Cannot delete your own account");
  }

  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (target.role === "ADMIN" && adminCount <= 1) {
    throw new Error("Cannot delete the last admin");
  }

  return prisma.user.delete({ where: { id: userId } });
}
