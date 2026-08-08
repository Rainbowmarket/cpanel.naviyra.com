import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { pingAgent } from "@/lib/agent/client";
import {
  getPermissionLabel,
  getPlatformName,
  hasAdminPermission,
} from "@/lib/permissions";
import { getSecurityOverview } from "@/lib/services/security";
import { collectDiskReport, formatDiskBytes } from "@/lib/system/disk";
import { ServerResourcesWatch } from "@/components/system/ServerResourcesWatch";
import { formatDate } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  Ban,
  Eye,
  Globe,
  HardDrive,
  Lock,
  Mail,
  Shield,
  ShieldAlert,
  Upload,
} from "lucide-react";

function isLiveMode(): boolean {
  if (process.env.AGENT_DRY_RUN === "true") return false;
  if (process.env.AGENT_DRY_RUN === "false") return true;
  return process.platform !== "win32";
}

function severityClass(severity: string) {
  if (severity === "CRITICAL" || severity === "HIGH") {
    return "bg-red-500/15 text-red-300";
  }
  if (severity === "MEDIUM") {
    return "bg-amber-500/15 text-amber-300";
  }
  return "bg-slate-800 text-slate-400";
}

function usedTone(pct: number | null) {
  if (pct == null) return "text-slate-400";
  if (pct >= 90) return "text-red-300";
  if (pct >= 75) return "text-amber-300";
  return "text-emerald-300";
}

function usedBar(pct: number | null) {
  if (pct == null) return "bg-slate-600";
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const isAdmin = hasAdminPermission();
  const liveMode = isLiveMode();
  const canManage = !liveMode || isAdmin;

  const [
    domainCount,
    mailCount,
    ftpCount,
    sslCount,
    agentOnline,
    security,
    recentThreats,
    recentBlocked,
    recentDomains,
    domainsForDisk,
    backupConfig,
  ] = await Promise.all([
    prisma.domain.count({ where: { userId: user.id } }),
    prisma.mailAccount.count({
      where: { mailDomain: { domain: { userId: user.id } } },
    }),
    prisma.ftpAccount.count({ where: { domain: { userId: user.id } } }),
    prisma.sslCertificate.count({
      where: { domain: { userId: user.id }, status: "ACTIVE" },
    }),
    pingAgent(),
    getSecurityOverview(user.id),
    prisma.securityEvent.findMany({
      where: { domain: { userId: user.id } },
      include: { domain: { select: { name: true } } },
      orderBy: { detectedAt: "desc" },
      take: 4,
    }),
    prisma.blockedIp.findMany({
      where: { isActive: true },
      orderBy: { blockedAt: "desc" },
      take: 4,
    }),
    prisma.domain.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        documentRoot: true,
        _count: {
          select: {
            subdomains: true,
            sslCerts: true,
          },
        },
      },
    }),
    prisma.domain.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, documentRoot: true },
    }),
    prisma.backupWorkerConfig.findFirst({
      select: { backupRoot: true },
    }),
  ]);

  const disk = await collectDiskReport({
    backupRoot: backupConfig?.backupRoot,
    websiteRoots: domainsForDisk.map((d) => ({
      id: d.id,
      label: d.name,
      path: d.documentRoot,
    })),
  });

  const volume = disk.volumes[0] ?? null;
  const usedPct =
    volume && volume.totalBytes > 0
      ? Math.min(100, Math.round((volume.usedBytes / volume.totalBytes) * 100))
      : null;
  const categoryPaths = disk.paths.filter((p) => !p.id.startsWith("domain:"));
  const domainSizeById = new Map(
    disk.paths
      .filter((p) => p.id.startsWith("domain:"))
      .map((p) => [p.id.replace(/^domain:/, ""), p.bytes] as const)
  );
  const categoryMax = Math.max(1, ...categoryPaths.map((p) => p.bytes ?? 0));

  const resourceStats = [
    { label: "Domains", value: domainCount, icon: Globe, href: "/dashboard/domains" },
    { label: "Mail", value: mailCount, icon: Mail, href: "/dashboard/mail" },
    { label: "FTP", value: ftpCount, icon: Upload, href: "/dashboard/ftp" },
    { label: "SSL", value: sslCount, icon: Lock, href: "/dashboard/ssl" },
  ];

  const securityStats = [
    {
      label: "Visitors",
      value: security.visitorsToday,
      icon: Eye,
      href: "/dashboard/security?tab=visitors",
    },
    {
      label: "Live",
      value: security.liveNow,
      icon: Activity,
      href: "/dashboard/security?tab=visitors",
    },
    {
      label: "Threats",
      value: security.threatsToday,
      icon: ShieldAlert,
      href: "/dashboard/security?tab=threats",
      alert: security.threatsToday > 0,
    },
    {
      label: "Blocked",
      value: security.blockedIps,
      icon: Ban,
      href: "/dashboard/security?tab=blocked",
      alert: security.blockedIps > 0,
    },
  ];

  const shortcuts = [
    { label: "Domains", href: "/dashboard/domains" },
    { label: "DNS", href: "/dashboard/dns" },
    { label: "Mail", href: "/dashboard/mail" },
    { label: "SSL", href: "/dashboard/ssl" },
    { label: "Files", href: "/dashboard/files" },
    { label: "Backups", href: "/dashboard/backups" },
    { label: "Security", href: "/dashboard/security" },
    { label: "Docs", href: "/dashboard/docs" },
    ...(user.role === "ADMIN"
      ? [{ label: "Speed Test", href: "/dashboard/speed-test" }]
      : []),
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-white sm:text-2xl">Dashboard</h2>
          <p className="mt-0.5 text-xs text-slate-400 sm:mt-1 sm:text-sm">
            Live CPU/RAM, storage, and security.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] sm:gap-2 sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-[11px] ${
              agentOnline
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                agentOnline ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            Agent {agentOnline ? "online" : "offline"}
          </div>
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] sm:gap-2 sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-[11px] ${
              canManage
                ? "border-slate-800 bg-slate-950/80 text-slate-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            <Shield className="h-3 w-3 text-emerald-400" />
            {getPlatformName()} · {getPermissionLabel()}
          </div>
          {!liveMode ? (
            <div className="inline-flex items-center rounded-md border border-slate-800 bg-slate-950/80 px-2 py-0.5 text-[10px] text-slate-400 sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-[11px]">
              Dry-run
            </div>
          ) : null}
        </div>
      </div>

      {/* Horizontal scroll on narrow screens — no awkward wrap */}
      <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap">
          {shortcuts.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-slate-700 hover:text-slate-200 active:bg-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {resourceStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5 transition hover:border-emerald-500/30 hover:bg-slate-900/70 active:bg-slate-900 sm:px-3.5 sm:py-3 xl:col-span-1"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {stat.label}
                </p>
                <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              </div>
              <p className="mt-1 text-lg font-semibold tabular-nums text-white sm:text-xl">
                {stat.value}
              </p>
            </Link>
          );
        })}
        {securityStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5 transition hover:bg-slate-900/70 active:bg-slate-900 sm:px-3.5 sm:py-3 xl:col-span-1"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {stat.label}
                </p>
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${
                    stat.alert ? "text-amber-400" : "text-emerald-400"
                  }`}
                />
              </div>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${
                  stat.alert ? "text-amber-200" : "text-white"
                }`}
              >
                {stat.value.toLocaleString()}
              </p>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <ServerResourcesWatch />

        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-emerald-400" />
              <div>
                <h3 className="text-sm font-semibold text-white">Storage</h3>
                <p className="text-[11px] text-slate-500">
                  {volume
                    ? `${formatDiskBytes(volume.availableBytes)} free on ${volume.mount}`
                    : "Disk usage"}
                </p>
              </div>
            </div>
            {usedPct != null ? (
              <span className={`text-sm font-semibold tabular-nums ${usedTone(usedPct)}`}>
                {usedPct}%
              </span>
            ) : null}
          </div>

          <div className="space-y-4 p-4">
            {volume ? (
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="text-lg font-semibold tabular-nums text-white">
                    {formatDiskBytes(volume.usedBytes)}
                    <span className="ml-1 text-sm font-normal text-slate-500">
                      / {formatDiskBytes(volume.totalBytes)}
                    </span>
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${usedBar(usedPct)}`}
                    style={{ width: `${usedPct ?? 0}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Disk usage unavailable.</p>
            )}

            <ul className="grid gap-2 sm:grid-cols-2">
              {categoryPaths.map((p) => {
                const pct = Math.round(((p.bytes ?? 0) / categoryMax) * 100);
                return (
                  <li
                    key={p.id}
                    className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-300">{p.label}</span>
                      <span className="tabular-nums text-slate-400">
                        {p.missing ? "—" : formatDiskBytes(p.bytes)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500/70"
                        style={{ width: `${p.bytes ? Math.max(6, pct) : 0}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
            <div>
              <h3 className="text-sm font-semibold text-white">Your domains</h3>
              <p className="text-[11px] text-slate-500">
                Status, SSL, and folder size.
              </p>
            </div>
            <Link
              href="/dashboard/domains"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
            >
              Manage
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {recentDomains.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              No domains yet.
            </p>
          ) : (
            <ul>
              {recentDomains.map((domain) => (
                <li
                  key={domain.id}
                  className="flex items-center justify-between gap-2 border-t border-slate-800/70 px-3 py-2.5 first:border-t-0 sm:gap-3 sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-white">
                        {domain.name}
                      </p>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                          domain.status === "ACTIVE"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {domain.status === "ACTIVE" ? "OK" : domain.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {domain._count.sslCerts} SSL
                      <span className="mx-1 text-slate-700">·</span>
                      {formatDiskBytes(domainSizeById.get(domain.id) ?? null)}
                      <span className="mx-1 hidden text-slate-700 sm:inline">·</span>
                      <span className="hidden sm:inline">
                        {formatDate(domain.createdAt)}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link
                      href="/dashboard/dns"
                      className="rounded-md border border-slate-700 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      DNS
                    </Link>
                    <Link
                      href="/dashboard/files"
                      className="rounded-md border border-slate-700 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      Files
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
          <div>
            <h3 className="text-sm font-semibold text-white">Security feed</h3>
            <p className="text-[11px] text-slate-500">
              Latest threats and active IP blocks.
            </p>
          </div>
          <Link
            href="/dashboard/security"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
          >
            Open security
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid lg:grid-cols-2">
          <div className="border-b border-slate-800 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between px-4 py-2">
              <p className="text-xs font-medium text-slate-300">Threats</p>
              <ShieldAlert className="h-3.5 w-3.5 text-slate-600" />
            </div>
            {recentThreats.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No threats logged yet.
              </p>
            ) : (
              <ul>
                {recentThreats.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 border-t border-slate-800/70 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-slate-200">
                        {t.ipAddress}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {t.threatType.replaceAll("_", " ")}
                        {t.domain?.name ? ` · ${t.domain.name}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityClass(t.severity)}`}
                    >
                      {t.severity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between px-4 py-2">
              <p className="text-xs font-medium text-slate-300">Blocks</p>
              <Ban className="h-3.5 w-3.5 text-slate-600" />
            </div>
            {recentBlocked.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No IPs currently blocked.
              </p>
            ) : (
              <ul>
                {recentBlocked.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-start justify-between gap-3 border-t border-slate-800/70 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-slate-200">
                        {b.ipAddress}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {b.reason}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400">
                      {b.source}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
