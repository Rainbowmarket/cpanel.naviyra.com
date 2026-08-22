import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { assertAgentTarget } from "@/lib/agent/target";

const CONFIG_ID = "default";

export const DEFAULT_MAX_UPLOAD_MB = 512;
export const MIN_MAX_UPLOAD_MB = 1;
export const MAX_MAX_UPLOAD_MB = 2048;

export function clampMaxUploadMb(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_UPLOAD_MB;
  return Math.max(MIN_MAX_UPLOAD_MB, Math.min(MAX_MAX_UPLOAD_MB, Math.floor(value)));
}

export async function getOrCreatePanelServerConfig() {
  const existing = await prisma.panelServerConfig.findUnique({
    where: { id: CONFIG_ID },
  });
  if (existing) return existing;
  return prisma.panelServerConfig.create({
    data: { id: CONFIG_ID, maxUploadMb: DEFAULT_MAX_UPLOAD_MB },
  });
}

export async function getMaxUploadMb(): Promise<number> {
  const config = await getOrCreatePanelServerConfig();
  return clampMaxUploadMb(config.maxUploadMb);
}

export async function updateMaxUploadMb(maxUploadMb: number) {
  await getOrCreatePanelServerConfig();
  const next = clampMaxUploadMb(maxUploadMb);

  await prisma.panelServerConfig.update({
    where: { id: CONFIG_ID },
    data: { maxUploadMb: next, lastError: null },
  });

  const servers = await prisma.server.findMany();
  let lastError: string | null = null;
  let applied = false;
  for (const server of servers) {
    if (!server.agentUrl?.trim() || !server.agentKey?.trim()) continue;
    const result = await callAgent<{
      applied?: boolean;
      maxMb?: number;
      dryRun?: boolean;
    }>(
      { action: "set_nginx_upload_limit", maxMb: next },
      assertAgentTarget(server)
    );
    if (!result.success) {
      lastError = result.error ?? "Failed to apply nginx upload limit";
    } else if (Boolean(result.data?.applied) && !result.data?.dryRun) {
      applied = true;
    }
  }

  if (!applied && !lastError) {
    lastError =
      servers.length === 0
        ? "No server is registered"
        : "Saved in the panel. nginx was not reloaded (dry-run or agent not on Linux).";
  }

  const nginxApplied = lastError ? false : applied;

  return prisma.panelServerConfig.update({
    where: { id: CONFIG_ID },
    data: {
      nginxApplied,
      lastError: nginxApplied ? null : lastError,
    },
  });
}

export async function applyStoredUploadLimitIfNeeded() {
  const config = await getOrCreatePanelServerConfig();
  if (config.nginxApplied) return config;
  return updateMaxUploadMb(config.maxUploadMb);
}
