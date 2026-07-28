import "dotenv/config";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const dbPath = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "naviyra.db")}`;
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  const agentKey = process.env.AGENT_API_KEY ?? "naviyra-local-agent-key";
  const ipAddress = process.env.SERVER_PUBLIC_IP?.trim() || "127.0.0.1";

  const hostname =
    process.env.DEFAULT_SERVER_HOSTNAME?.trim() || "server1.naviyra.uk";

  const server = await prisma.server.upsert({
    where: { hostname },
    create: {
      name: "Primary Server",
      hostname,
      ipAddress,
      agentKey,
    },
    update: { agentKey, ipAddress },
  });

  console.log("Seeded server:", server.hostname, `(${server.ipAddress})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
