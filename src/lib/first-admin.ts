import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";

/** One SQLite write makes setup exclusive across requests and panel processes. */
export async function createFirstAdmin(
  db: PrismaClient,
  input: { name: string; email: string; passwordHash: string }
) {
  const id = randomUUID();
  const now = new Date();
  const inserted = await db.$executeRaw`
    INSERT INTO "User"
      ("id", "name", "email", "passwordHash", "role", "sessionVersion",
       "twoFactorEnabled", "createdAt", "updatedAt")
    SELECT ${id}, ${input.name}, ${input.email}, ${input.passwordHash},
           'ADMIN', 0, false, ${now}, ${now}
    WHERE NOT EXISTS (SELECT 1 FROM "User")
  `;
  if (inserted === 0) return null;
  return db.user.findUniqueOrThrow({ where: { id } });
}
