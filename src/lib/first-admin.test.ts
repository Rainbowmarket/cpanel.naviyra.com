import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaAdapter } from "./db-adapter";
import { createFirstAdmin } from "./first-admin";

test("first-admin setup is exclusive across independent database connections", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "naviyra-setup-"));
  const clients = Array.from({ length: 4 }, () => new PrismaClient({
    adapter: createPrismaAdapter(path.join(directory, "setup.db")),
  }));
  try {
    await clients[0].$executeRawUnsafe(`CREATE TABLE "User" (
      "id" TEXT PRIMARY KEY, "email" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'USER', "sessionVersion" INTEGER NOT NULL DEFAULT 0,
      "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
      "twoFactorSecret" TEXT, "twoFactorPendingSecret" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`);
    const results = await Promise.all(clients.map((db, index) => createFirstAdmin(db, {
      name: `Admin ${index}`, email: `admin${index}@example.com`, passwordHash: "test-hash",
    })));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await clients[0].user.count(), 1);
    const user = results.find((result) => result !== null)!;
    assert.equal(user.role, "ADMIN");
    assert.equal(user.sessionVersion, 0);
    assert.equal(user.twoFactorEnabled, false);
    assert.ok(user.createdAt instanceof Date);
    assert.equal(await createFirstAdmin(clients[1], {
      name: "Another admin", email: user.email, passwordHash: "replacement",
    }), null);
    assert.equal((await clients[0].user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, "test-hash");

    // Any existing user closes public setup, even when that user is not an admin.
    await clients[0].user.update({ where: { id: user.id }, data: { role: "USER" } });
    assert.equal(await createFirstAdmin(clients[2], {
      name: "Rejected admin", email: "rejected@example.com", passwordHash: "test-hash",
    }), null);
  } finally {
    await Promise.all(clients.map((db) => db.$disconnect()));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
