import type { AppStatus, AppType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey } from "@/lib/paths";
import {
  isProxyAppType,
  mergeAppModeEnv,
  phpEnabledForAppType,
  resolveStartCommand,
  type AppMode,
} from "@/lib/apps/runtime-helpers";

export {
  APP_TYPES,
  isProxyAppType,
  mergeAppModeEnv,
  parseAppModeFromEnv,
  phpEnabledForAppType,
  resolveStartCommand,
  type AppMode,
} from "@/lib/apps/runtime-helpers";

type SiteKind = "domain" | "subdomain";

async function loadSite(kind: SiteKind, id: string, userId: string) {
  if (kind === "domain") {
    const domain = await prisma.domain.findFirstOrThrow({
      where: { id, userId },
      include: { server: true },
    });
    return {
      kind: "domain" as const,
      id: domain.id,
      siteName: domain.name,
      documentRoot: domain.documentRoot,
      appType: domain.appType,
      startCommand: domain.startCommand,
      appStartupFile: domain.appStartupFile,
      appWorkingDir: domain.appWorkingDir,
      upstreamPort: domain.upstreamPort,
      appStatus: domain.appStatus,
      appEnv: domain.appEnv,
      agentKey: domain.server.agentKey || getAgentApiKey(),
    };
  }

  const subdomain = await prisma.subdomain.findFirstOrThrow({
    where: { id, domain: { userId } },
    include: { domain: { include: { server: true } } },
  });
  return {
    kind: "subdomain" as const,
    id: subdomain.id,
    siteName: `${subdomain.name}.${subdomain.domain.name}`,
    documentRoot: subdomain.documentRoot,
    appType: subdomain.appType,
    startCommand: subdomain.startCommand,
    appStartupFile: subdomain.appStartupFile,
    appWorkingDir: subdomain.appWorkingDir,
    upstreamPort: subdomain.upstreamPort,
    appStatus: subdomain.appStatus,
    appEnv: subdomain.appEnv,
    agentKey: subdomain.domain.server.agentKey || getAgentApiKey(),
  };
}

async function persistSite(
  kind: SiteKind,
  id: string,
  data: {
    appType?: AppType;
    startCommand?: string | null;
    appStartupFile?: string | null;
    appWorkingDir?: string;
    upstreamPort?: number | null;
    appStatus?: AppStatus;
    appEnv?: string | null;
  }
) {
  if (kind === "domain") {
    return prisma.domain.update({ where: { id }, data });
  }
  return prisma.subdomain.update({ where: { id }, data });
}

export async function configureSiteApp(
  kind: SiteKind,
  id: string,
  userId: string,
  input: {
    appType: AppType;
    startCommand?: string;
    appStartupFile?: string | null;
    appWorkingDir?: string;
    appEnv?: string | null;
    appMode?: AppMode | null;
  }
) {
  const site = await loadSite(kind, id, userId);
  const appType = input.appType;
  const appStartupFile =
    input.appStartupFile !== undefined
      ? input.appStartupFile?.trim() || null
      : site.appStartupFile;
  const startCommand = resolveStartCommand({
    appType,
    startCommand: input.startCommand ?? site.startCommand,
    appStartupFile,
  });
  const appWorkingDir = input.appWorkingDir?.trim() || site.appWorkingDir || ".";
  let appEnv = input.appEnv !== undefined ? input.appEnv : site.appEnv;
  if (input.appMode) {
    appEnv = mergeAppModeEnv(appEnv, input.appMode);
  }

  if (isProxyAppType(appType) && !startCommand) {
    throw new Error(
      "Start command or application startup file is required for Node, Python, and Go apps"
    );
  }

  const result = await callAgent<{
    appType: string;
    upstreamPort: number | null;
    phpEnabled: boolean;
  }>(
    {
      action: "configure_site_app",
      siteId: site.id,
      siteName: site.siteName,
      documentRoot: site.documentRoot,
      appType,
      startCommand: startCommand || undefined,
      appWorkingDir,
      appEnv,
      upstreamPort: site.upstreamPort,
      isSubdomain: kind === "subdomain",
    },
    site.agentKey
  );

  if (!result.success) {
    throw new Error(result.error ?? "Failed to configure app");
  }

  const upstreamPort = result.data?.upstreamPort ?? null;

  await persistSite(kind, id, {
    appType,
    startCommand: isProxyAppType(appType) ? startCommand : null,
    appStartupFile: isProxyAppType(appType) ? appStartupFile : null,
    appWorkingDir,
    upstreamPort,
    appEnv: isProxyAppType(appType) ? appEnv : null,
    appStatus: "STOPPED",
  });

  if (kind === "domain") {
    await prisma.domain.update({
      where: { id },
      data: { phpEnabled: phpEnabledForAppType(appType) },
    });
  }

  return loadSite(kind, id, userId);
}

export async function controlSiteApp(
  kind: SiteKind,
  id: string,
  userId: string,
  op: "start" | "stop" | "restart" | "status"
) {
  const site = await loadSite(kind, id, userId);
  if (!isProxyAppType(site.appType) && op !== "status") {
    throw new Error("Start/Stop only applies to Node, Python, and Go apps");
  }

  if (op === "status") {
    const result = await callAgent<{ active: boolean; exists: boolean }>(
      { action: "app_status", siteId: site.id },
      site.agentKey
    );
    const active = Boolean(result.data?.active);
    const appStatus: AppStatus = active ? "RUNNING" : "STOPPED";
    await persistSite(kind, id, { appStatus });
    return { ...site, appStatus, active };
  }

  const action =
    op === "start" ? "app_start" : op === "stop" ? "app_stop" : "app_restart";
  const result = await callAgent<{ active?: boolean }>(
    { action, siteId: site.id },
    site.agentKey
  );
  if (!result.success) {
    await persistSite(kind, id, { appStatus: "ERROR" });
    throw new Error(result.error ?? `App ${op} failed`);
  }

  let active = false;
  if (op === "stop") {
    active = false;
  } else if (typeof result.data?.active === "boolean") {
    active = result.data.active;
  } else {
    active = true;
  }
  const appStatus: AppStatus = active ? "RUNNING" : "STOPPED";
  await persistSite(kind, id, { appStatus });
  return { ...(await loadSite(kind, id, userId)), active };
}

export async function removeSiteAppUnit(
  kind: SiteKind,
  id: string,
  userId: string
) {
  const site = await loadSite(kind, id, userId);
  await callAgent({ action: "app_remove", siteId: site.id }, site.agentKey);
}
