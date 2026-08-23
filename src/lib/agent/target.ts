import { prisma } from "@/lib/prisma";
import { getAgentApiKey } from "@/lib/paths";

export type AgentTarget = {
  agentUrl: string;
  agentKey: string;
};

export function defaultControllerAgentUrl(): string {
  const fromEnv = process.env.AGENT_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const port =
    process.env.AGENT_PORT?.trim() ||
    (process.platform === "linux" ? "4100" : "4000");
  return `http://127.0.0.1:${port}`;
}

export function assertAgentTarget(server: {
  agentUrl: string | null;
  agentKey: string;
  hostname?: string;
  name?: string;
}): AgentTarget {
  const agentUrl = (server.agentUrl || "").trim().replace(/\/$/, "");
  const agentKey = (server.agentKey || "").trim();
  const label = server.hostname || server.name || "server";
  if (!agentUrl) {
    throw new Error(
      `Server ${label} has no Agent URL. Edit the server and set the agent URL.`
    );
  }
  if (!agentUrl.startsWith("http://") && !agentUrl.startsWith("https://")) {
    throw new Error(`Server ${label}: Agent URL must be http or https`);
  }
  if (!agentKey) {
    throw new Error(`Server ${label} has no agent key`);
  }
  return { agentUrl, agentKey };
}

/** Fill loopback URL + panel key on the first registered node if missing. */
export async function ensureControllerNode() {
  const primary = await prisma.server.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!primary) return null;
  const agentUrl = primary.agentUrl?.trim() || defaultControllerAgentUrl();
  const agentKey = primary.agentKey?.trim() || getAgentApiKey();
  if (primary.agentUrl === agentUrl && primary.agentKey === agentKey) {
    return primary;
  }
  return prisma.server.update({
    where: { id: primary.id },
    data: { agentUrl, agentKey },
  });
}

export async function agentTargetForServerId(serverId: string): Promise<AgentTarget> {
  await ensureControllerNode();
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw new Error("Server not found");
  return assertAgentTarget(server);
}

/** The node that runs this panel (first registered server). */
export async function controllerAgentTarget(): Promise<AgentTarget> {
  const primary = await ensureControllerNode();
  if (!primary) {
    throw new Error("No server is registered. Add a server in Admin → Servers.");
  }
  return assertAgentTarget(primary);
}
