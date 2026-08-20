import type { AppStatus, AppType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey } from "@/lib/paths";
import {
  domainAccessWhere,
  type AccessActor,
} from "@/lib/hosting-targets";
import {
  isProxyAppType,
  mergeAppModeEnv,
  normalizeAppWorkingDir,
  phpEnabledForAppType,
  resolveStartCommand,
  type AppMode,
} from "@/lib/apps/runtime-helpers";

export {
  APP_TYPES,
  fastapiStartCommand,
  isProxyAppType,
  mergeAppModeEnv,
  parseAppModeFromEnv,
  phpEnabledForAppType,
  resolveStartCommand,
  type AppMode,
} from "@/lib/apps/runtime-helpers";

type SiteKind = "domain" | "subdomain";
type Actor = AccessActor | string;

function asActor(user: Actor): AccessActor {
  return typeof user === "string" ? { id: user, role: "USER" } : user;
}

async function loadSite(kind: SiteKind, id: string, user: Actor) {
  const access = domainAccessWhere(user);
  if (kind === "domain") {
    const domain = await prisma.domain.findFirstOrThrow({
      where: { id, ...access },
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
    where: { id, domain: access },
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

export async function listSiteApps(user: Actor) {
  const access = domainAccessWhere(asActor(user));
  const domains = await prisma.domain.findMany({
    where: access,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      documentRoot: true,
      appType: true,
      startCommand: true,
      appStartupFile: true,
      appWorkingDir: true,
      upstreamPort: true,
      appStatus: true,
      appEnv: true,
    },
  });
  const subdomains = await prisma.subdomain.findMany({
    where: { domain: access },
    orderBy: [{ domain: { name: "asc" } }, { name: "asc" }],
    include: { domain: { select: { name: true } } },
  });
  return [
    ...domains.map((d) => ({
      kind: "domain" as const,
      id: d.id,
      hostname: d.name,
      documentRoot: d.documentRoot,
      appType: d.appType,
      startCommand: d.startCommand,
      appStartupFile: d.appStartupFile,
      appWorkingDir: d.appWorkingDir,
      upstreamPort: d.upstreamPort,
      appStatus: d.appStatus,
      appEnv: d.appEnv,
    })),
    ...subdomains.map((s) => ({
      kind: "subdomain" as const,
      id: s.id,
      hostname: `${s.name}.${s.domain.name}`,
      documentRoot: s.documentRoot,
      appType: s.appType,
      startCommand: s.startCommand,
      appStartupFile: s.appStartupFile,
      appWorkingDir: s.appWorkingDir,
      upstreamPort: s.upstreamPort,
      appStatus: s.appStatus,
      appEnv: s.appEnv,
    })),
  ];
}

export async function getSiteAppLogs(
  kind: SiteKind,
  id: string,
  user: Actor
) {
  const site = await loadSite(kind, id, user);
  const result = await callAgent<{ unitName: string; logs: string }>(
    { action: "app_logs", siteId: site.id, lines: 80 },
    site.agentKey
  );
  return {
    site,
    unitName: result.data?.unitName ?? null,
    logs: result.data?.logs ?? (result.error || ""),
  };
}

export async function configureSiteApp(
  kind: SiteKind,
  id: string,
  user: Actor,
  input: {
    appType: AppType;
    startCommand?: string;
    appStartupFile?: string | null;
    appWorkingDir?: string;
    appEnv?: string | null;
    appMode?: AppMode | null;
  }
) {
  const site = await loadSite(kind, id, user);
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
  const appWorkingDir = normalizeAppWorkingDir(
    input.appWorkingDir?.trim() || site.appWorkingDir || ".",
    site.documentRoot
  );
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

  return loadSite(kind, id, user);
}

export async function controlSiteApp(
  kind: SiteKind,
  id: string,
  user: Actor,
  op: "start" | "stop" | "restart" | "status"
) {
  let site = await loadSite(kind, id, user);
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

  if (op === "start" || op === "restart") {
    site = await configureSiteApp(kind, id, user, {
      appType: site.appType,
      startCommand: site.startCommand ?? undefined,
      appStartupFile: site.appStartupFile,
      appWorkingDir: site.appWorkingDir,
      appEnv: site.appEnv,
    });
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
  return { ...(await loadSite(kind, id, user)), active };
}

export async function removeSiteAppUnit(
  kind: SiteKind,
  id: string,
  user: Actor
) {
  const site = await loadSite(kind, id, user);
  await callAgent({ action: "app_remove", siteId: site.id }, site.agentKey);
}
