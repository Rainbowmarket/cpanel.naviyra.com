import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId, controllerAgentTarget } from "@/lib/agent/target";
import { listSiteApps } from "@/lib/services/apps";
import type { AccessActor } from "@/lib/hosting-targets";

type Actor = AccessActor | string;

export async function listDockerContainers() {
  const result = await callAgent<{
    containers?: Array<{
      id: string;
      name: string;
      image: string;
      status: string;
      state: string;
      ports: string;
    }>;
    available?: boolean;
    dryRun?: boolean;
  }>({ action: "docker_ps" }, await controllerAgentTarget());
  if (!result.success) {
    throw new Error(result.error ?? "Failed to list Docker containers");
  }
  return {
    containers: result.data?.containers ?? [],
    available: result.data?.available !== false,
    dryRun: Boolean(result.data?.dryRun),
  };
}

export async function controlDockerContainer(
  id: string,
  op: "start" | "stop" | "restart"
) {
  const result = await callAgent(
    { action: "docker_control", id, op },
    await controllerAgentTarget()
  );
  if (!result.success) {
    throw new Error(result.error ?? `Failed to ${op} container`);
  }
  return result.data;
}

export async function getDockerLogs(id: string, lines = 80) {
  const result = await callAgent<{ logs?: string }>(
    {
      action: "docker_logs",
      id,
      lines,
    },
    await controllerAgentTarget()
  );
  if (!result.success) {
    throw new Error(result.error ?? "Failed to read container logs");
  }
  return { logs: result.data?.logs ?? "" };
}

export async function composeUpForSite(user: Actor, kind: "domain" | "subdomain", id: string) {
  const sites = await listSiteApps(user);
  const site = sites.find((s) => s.kind === kind && s.id === id);
  if (!site) throw new Error("Site not found");
  const composePath = `${site.documentRoot.replace(/\\/g, "/")}/docker-compose.yml`;
  const result = await callAgent<{
    composePath?: string;
    dryRun?: boolean;
  }>(
    {
      action: "docker_compose_up",
      composePath,
      documentRoot: site.documentRoot,
    },
    await agentTargetForServerId(site.serverId)
  );
  if (!result.success) {
    throw new Error(result.error ?? "Compose up failed");
  }
  return {
    composePath: result.data?.composePath ?? composePath,
    dryRun: Boolean(result.data?.dryRun),
    hostname: site.hostname,
  };
}
