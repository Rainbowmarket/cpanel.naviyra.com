import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdapter } from "../src/lib/db-adapter";

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

async function main() {
  const agentKey =
    process.env.AGENT_API_KEY?.trim() &&
    process.env.AGENT_API_KEY.trim() !== "naviyra-local-agent-key"
      ? process.env.AGENT_API_KEY.trim()
      : `seed-${randomBytes(16).toString("hex")}`;
  if (!process.env.AGENT_API_KEY || process.env.AGENT_API_KEY === "naviyra-local-agent-key") {
    console.warn(
      "[seed] AGENT_API_KEY missing/weak — using a random key for this seed run only. Set AGENT_API_KEY in .env."
    );
  }
  const ipAddress = process.env.SERVER_PUBLIC_IP?.trim() || "127.0.0.1";

  const hostname =
    process.env.DEFAULT_SERVER_HOSTNAME?.trim() ||
    (() => {
      const panel = process.env.PANEL_HOSTNAME?.trim().replace(/^www\./, "") || "";
      if (!panel) return "s1.localhost";
      const parts = panel.split(".").filter(Boolean);
      const apex = parts.length >= 3 ? parts.slice(1).join(".") : panel;
      return `s1.${apex}`;
    })();

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
