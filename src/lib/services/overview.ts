import { spawnSync } from "node:child_process";
import net from "node:net";
import { prisma } from "@/lib/prisma";
import { pingAgent } from "@/lib/agent/client";
import { controllerAgentTarget } from "@/lib/agent/target";
import { domainAccessWhere, type AccessActor } from "@/lib/hosting-targets";
import { collectResourceReport, formatUptime, formatMemBytes } from "@/lib/system/resources";
import { collectDiskReport, formatDiskBytes } from "@/lib/system/disk";
import { evaluateAndNotifyHostAlerts } from "@/lib/mail/admin-alerts";
import { defaultControllerAgentUrl } from "@/lib/agent/target";
import { migrateLegacyVisitorLogsIfNeeded } from "@/lib/visitors/migrate-legacy";
import { groupVisitorCountsByDomain } from "@/lib/visitors/store";

export type OverviewAlert = {
  id: string;
  tone: "critical" | "warning";
  title: string;
  href: string;
};

export type OverviewService = {
  id: string;
  label: string;
  ok: boolean;
  href: string;
};

export type OverviewTopSite = {
  id: string;
  name: string;
  hits: number;
};

function portOpen(host: string, port: number, timeoutMs = 900): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    const t = setTimeout(() => done(false), timeoutMs);
    socket.on("connect", () => {
      clearTimeout(t);
      done(true);
    });
    socket.on("error", () => {
      clearTimeout(t);
      done(false);
    });
  });
}

function systemctlActive(unit: string): boolean {
  if (process.platform !== "linux") return false;
  return (
    spawnSync("systemctl", ["is-active", "--quiet", unit], { windowsHide: true })
      .status === 0
  );
}

function ufwActive(): boolean | null {
  if (process.platform !== "linux") return null;
  const r = spawnSync("ufw", ["status"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0 && !(r.stdout || r.stderr)) return null;
  return /Status:\s*active/i.test(`${r.stdout || ""}\n${r.stderr || ""}`);
}

export async function getDashboardOverview(actor: AccessActor) {
  await migrateLegacyVisitorLogsIfNeeded();
  const access = domainAccessWhere(actor);
  const isAdmin = actor.role === "ADMIN";
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sslSoon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const pgPort = Number(process.env.CUSTOMER_POSTGRES_PORT?.trim() || "5432") || 5432;

  const [
    health,
    disk,
    agentOnline,
    expiringSsl,
    trafficGroups,
    threats24h,
    brute24h,
    blockedIps,
    backup,
  ] = await Promise.all([
    collectResourceReport(),
    collectDiskReport({}),
    pingAgent(await controllerAgentTarget()),
    prisma.sslCertificate.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lte: sslSoon, gte: new Date() },
        domain: access,
      },
      select: {
        id: true,
        expiresAt: true,
        domain: { select: { name: true } },
        subdomain: { select: { name: true } },
      },
      orderBy: { expiresAt: "asc" },
      take: 5,
    }),
    Promise.resolve(
      groupVisitorCountsByDomain(
        {
          admin: isAdmin,
          userId: isAdmin ? undefined : actor.id,
        },
        since24h,
        5
      )
    ),
    prisma.securityEvent.count({
      where: { detectedAt: { gte: since24h }, domain: access },
    }),
    prisma.securityEvent.count({
      where: {
        detectedAt: { gte: since24h },
        threatType: "BRUTE_FORCE",
        domain: access,
      },
    }),
    prisma.blockedIp.count({ where: { isActive: true } }),
    actor.role === "ADMIN"
      ? prisma.backupWorkerConfig.findFirst({
          select: { lastStatus: true, lastError: true, enabled: true },
        })
      : Promise.resolve(null),
  ]);

  const [nginxOk, dbOk, mailOk, ftpOk] = await Promise.all([
    process.platform === "linux"
      ? Promise.resolve(systemctlActive("nginx.service"))
      : portOpen("127.0.0.1", 80),
    portOpen("127.0.0.1", pgPort),
    Promise.all([portOpen("127.0.0.1", 25), portOpen("127.0.0.1", 587)]).then(
      (ports) => ports.some(Boolean)
    ),
    portOpen("127.0.0.1", 21),
  ]);

  const volume = disk.volumes[0] ?? null;
  const diskPct =
    volume && volume.totalBytes > 0
      ? Math.min(
          100,
          Math.round((volume.usedBytes / volume.totalBytes) * 1000) / 10
        )
      : null;

  evaluateAndNotifyHostAlerts({
    hostname: health.hostname,
    cpuPercent: health.cpu.percent,
    memPercent: health.memory.percent,
    load1: health.cpu.loadAvg?.[0] ?? null,
    cores: health.cpu.cores,
    diskPercent: diskPct,
    diskLabel: volume
      ? `${formatDiskBytes(volume.usedBytes)} / ${formatDiskBytes(volume.totalBytes)}`
      : undefined,
    agentOnline,
    agentUrl: defaultControllerAgentUrl(),
  });

  const domainIds = trafficGroups.map((g) => g.domainId);
  const domainNames =
    domainIds.length === 0
      ? []
      : await prisma.domain.findMany({
          where: { id: { in: domainIds }, ...access },
          select: { id: true, name: true },
        });
  const nameById = new Map(domainNames.map((d) => [d.id, d.name]));
  const topSites: OverviewTopSite[] = trafficGroups.map((g) => ({
    id: g.domainId,
    name: nameById.get(g.domainId) ?? "Site",
    hits: g.count,
  }));

  const services: OverviewService[] = [
    { id: "nginx", label: "Nginx", ok: nginxOk, href: "/dashboard/services" },
    { id: "database", label: "Database", ok: dbOk, href: "/dashboard/databases" },
    { id: "mail", label: "Mail", ok: mailOk, href: "/dashboard/services" },
    { id: "ftp", label: "FTP", ok: ftpOk, href: "/dashboard/services" },
  ];

  const alerts: OverviewAlert[] = [];
  if (!agentOnline) {
    alerts.push({
      id: "agent",
      tone: "critical",
      title: "Server agent is offline",
      href: "/dashboard/service-tests",
    });
  }
  if (diskPct != null && diskPct >= 90) {
    alerts.push({
      id: "disk-crit",
      tone: "critical",
      title: `Disk space is critically low (${diskPct}%)`,
      href: "/dashboard/monitoring",
    });
  } else if (diskPct != null && diskPct >= 80) {
    alerts.push({
      id: "disk-warn",
      tone: "warning",
      title: `Disk space is running low (${diskPct}%)`,
      href: "/dashboard/monitoring",
    });
  }
  for (const svc of services) {
    if (!svc.ok) {
      alerts.push({
        id: `svc-${svc.id}`,
        tone: "critical",
        title: `${svc.label} is not responding`,
        href: svc.href,
      });
    }
  }
  if (expiringSsl.length > 0) {
    const first = expiringSsl[0];
    const host = first.subdomain
      ? `${first.subdomain.name}.${first.domain.name}`
      : first.domain.name;
    const extra = expiringSsl.length > 1 ? ` (+${expiringSsl.length - 1} more)` : "";
    alerts.push({
      id: "ssl",
      tone: "warning",
      title: `SSL expiring soon: ${host}${extra}`,
      href: "/dashboard/ssl",
    });
  }
  if (backup?.lastStatus === "FAILED") {
    alerts.push({
      id: "backup",
      tone: "warning",
      title: backup.lastError?.slice(0, 80) || "Last automatic backup failed",
      href: "/dashboard/backups",
    });
  }

  const firewall = ufwActive();

  return {
    health: {
      cpuPercent: health.cpu.percent,
      memPercent: health.memory.percent,
      memLabel: `${formatMemBytes(health.memory.usedBytes)} / ${formatMemBytes(health.memory.totalBytes)}`,
      diskPercent: diskPct,
      diskLabel: volume
        ? `${formatDiskBytes(volume.usedBytes)} / ${formatDiskBytes(volume.totalBytes)}`
        : "—",
      uptime: formatUptime(health.uptimeSeconds),
      hostname: health.hostname,
    },
    alerts: alerts.slice(0, 5),
    services,
    topSites,
    security: {
      firewallActive: firewall,
      failedLogins24h: brute24h,
      threats24h,
      blockedIps,
    },
    agentOnline,
  };
}
