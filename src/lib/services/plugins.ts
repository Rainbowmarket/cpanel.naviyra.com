import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId } from "@/lib/agent/target";
import type { PluginManifest, PluginOp } from "@/lib/plugins/contract";

export async function refreshServerPlugins(serverId: string) {
  const target = await agentTargetForServerId(serverId);
  const result = await callAgent<{ plugins?: PluginManifest[] }>(
    { action: "list_plugins" },
    target
  );
  if (!result.success) {
    throw new Error(result.error ?? "Could not list plugins on that agent");
  }
  const plugins = result.data?.plugins ?? [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    seen.add(plugin.id);
    const installed = Boolean(
      (plugin as PluginManifest & { installed?: boolean }).installed
    );
    const health = (plugin as PluginManifest & { health?: string }).health ?? null;
    await prisma.serverPlugin.upsert({
      where: { serverId_pluginId: { serverId, pluginId: plugin.id } },
      create: {
        serverId,
        pluginId: plugin.id,
        name: plugin.name,
        kind: plugin.kind,
        installed,
        health,
        lastSeenAt: new Date(),
      },
      update: {
        name: plugin.name,
        kind: plugin.kind,
        installed,
        health,
        lastSeenAt: new Date(),
      },
    });
  }
  if (seen.size > 0) {
    await prisma.serverPlugin.deleteMany({
      where: { serverId, pluginId: { notIn: [...seen] } },
    });
  }
  return prisma.serverPlugin.findMany({
    where: { serverId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
}

export async function listServerPlugins(serverId: string, refresh = true) {
  if (refresh) {
    try {
      return await refreshServerPlugins(serverId);
    } catch (error) {
      const cached = await prisma.serverPlugin.findMany({
        where: { serverId },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
      });
      if (cached.length > 0) {
        return cached.map((row) => ({
          ...row,
          health: row.health ?? (error instanceof Error ? error.message : "offline"),
        }));
      }
      throw error;
    }
  }
  return prisma.serverPlugin.findMany({
    where: { serverId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
}

export async function invokeServerPlugin(input: {
  serverId: string;
  pluginId: string;
  op: PluginOp;
  params?: Record<string, unknown>;
}) {
  const target = await agentTargetForServerId(input.serverId);
  const result = await callAgent(
    {
      action: "plugin_invoke",
      pluginId: input.pluginId,
      op: input.op,
      params: input.params ?? {},
    },
    target
  );
  if (!result.success) {
    throw new Error(result.error ?? "Plugin action failed");
  }
  await refreshServerPlugins(input.serverId).catch(() => undefined);
  return result.data;
}
