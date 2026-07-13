import "dotenv/config";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const dbPath = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "naviyra.db")}`;
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  const certs = await prisma.sslCertificate.findMany({
    orderBy: { createdAt: "desc" },
  });

  const seen = new Set<string>();
  const toDelete: string[] = [];

  for (const cert of certs) {
    if (seen.has(cert.domainId)) {
      toDelete.push(cert.id);
    } else {
      seen.add(cert.domainId);
    }
  }

  if (toDelete.length > 0) {
    await prisma.sslCertificate.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`Removed ${toDelete.length} duplicate SSL certificate(s)`);
  } else {
    console.log("No duplicate SSL certificates found");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
