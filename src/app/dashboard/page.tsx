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
      take: 5,
    }),
    prisma.blockedIp.findMany({
      where: { isActive: true },
      orderBy: { blockedAt: "desc" },
      take: 5,
    }),
    prisma.domain.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
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
  const domainPaths = disk.paths.filter((p) => p.id.startsWith("domain:"));
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
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-400">
            Domains, mail, security, and hosting controls in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
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
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
              canManage
                ? "border-slate-800 bg-slate-950/80 text-slate-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            <Shield className="h-3.5 w-3.5 text-emerald-400" />
            {getPlatformName()} · {getPermissionLabel()}
            {!canManage && liveMode ? " · admin required" : ""}
          </div>
          {!liveMode ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-400">
              Dry-run
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {shortcuts.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {resourceStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-emerald-500/30 hover:bg-slate-900/80"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {stat.label}
                </p>
                <Icon className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">
                {stat.value}
              </p>
            </Link>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2.5">
            <HardDrive className="mt-0.5 h-4 w-4 text-emerald-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">Storage</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Server disk usage and hosting folder sizes.
              </p>
            </div>
          </div>
          {volume ? (
            <p className="text-[11px] text-slate-500">
              Mount {volume.mount}
              {disk.volumes.length > 1 ? ` · ${disk.volumes.length} volumes` : ""}
            </p>
          ) : null}
        </div>

        <div className="grid gap-0 lg:grid-cols-2">
          <div className="border-b border-slate-800 p-4 sm:p-5 lg:border-r lg:border-b-0">
            {volume ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      Disk used
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                      {formatDiskBytes(volume.usedBytes)}
                      <span className="ml-1.5 text-sm font-normal text-slate-500">
                        / {formatDiskBytes(volume.totalBytes)}
                      </span>
                    </p>
                  </div>
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      (usedPct ?? 0) >= 90
                        ? "text-red-300"
                        : (usedPct ?? 0) >= 75
                          ? "text-amber-300"
                          : "text-emerald-300"
                    }`}
                  >
                    {usedPct}%
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all ${
                      (usedPct ?? 0) >= 90
                        ? "bg-red-500"
                        : (usedPct ?? 0) >= 75
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }`}
                    style={{ width: `${usedPct ?? 0}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>
                    Free{" "}
                    <span className="text-slate-300">
                      {formatDiskBytes(volume.availableBytes)}
                    </span>
                  </span>
                  {disk.volumes.slice(1).map((v) => {
                    const pct =
                      v.totalBytes > 0
                        ? Math.round((v.usedBytes / v.totalBytes) * 100)
                        : 0;
                    return (
                      <span key={v.mount}>
                        {v.mount}{" "}
                        <span className="text-slate-300">
                          {pct}% · {formatDiskBytes(v.availableBytes)} free
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">
                Disk usage unavailable on this host.
              </p>
            )}
          </div>

          <div className="p-4 sm:p-5">
            <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              By category
            </p>
            <ul className="space-y-2.5">
              {categoryPaths.map((p) => {
                const pct = Math.round(((p.bytes ?? 0) / categoryMax) * 100);
                return (
                  <li key={p.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-300">{p.label}</span>
                      <span className="tabular-nums text-slate-400">
                        {p.missing ? "missing" : formatDiskBytes(p.bytes)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500/70"
                        style={{ width: `${p.bytes ? Math.max(4, pct) : 0}%` }}
                      />
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-slate-600" title={p.path}>
                      {p.path}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {domainPaths.length > 0 ? (
          <div className="border-t border-slate-800">
            <div className="flex items-center justify-between px-4 py-2.5 sm:px-5">
              <p className="text-xs font-medium text-slate-300">Per domain</p>
              <Link
                href="/dashboard/files"
                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
              >
                Files
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <ul>
              {domainPaths.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 px-4 py-2.5 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{p.label}</p>
                    <p className="truncate font-mono text-[10px] text-slate-600" title={p.path}>
                      {p.path}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums text-sm text-slate-300">
                    {p.missing ? "—" : formatDiskBytes(p.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-white">Security today</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Traffic, threats, and active blocks across your domains.
            </p>
          </div>
          <Link
            href="/dashboard/security"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            Open security
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 border-b border-slate-800 sm:grid-cols-4">
          {securityStats.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <Link
                key={stat.label}
                href={stat.href}
                className={`px-4 py-3.5 transition hover:bg-slate-900/60 sm:px-5 ${
                  idx % 2 === 1 ? "border-l border-slate-800" : ""
                } ${idx >= 2 ? "border-t border-slate-800 sm:border-t-0" : ""} ${
                  idx >= 1 ? "sm:border-l sm:border-slate-800" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    {stat.label}
                  </p>
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      stat.alert ? "text-amber-400" : "text-emerald-400"
                    }`}
                  />
                </div>
                <p
                  className={`mt-1.5 text-xl font-semibold tabular-nums ${
                    stat.alert ? "text-amber-200" : "text-white"
                  }`}
                >
                  {stat.value}
                </p>
              </Link>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-2">
          <div className="border-b border-slate-800 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between px-4 py-2.5 sm:px-5">
              <p className="text-xs font-medium text-slate-300">Recent threats</p>
              <ShieldAlert className="h-3.5 w-3.5 text-slate-600" />
            </div>
            {recentThreats.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500 sm:px-5">
                No threats logged yet.
              </p>
            ) : (
              <ul>
                {recentThreats.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 border-t border-slate-800/70 px-4 py-2.5 sm:px-5"
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
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${severityClass(t.severity)}`}
                    >
                      {t.severity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between px-4 py-2.5 sm:px-5">
              <p className="text-xs font-medium text-slate-300">Active blocks</p>
              <Ban className="h-3.5 w-3.5 text-slate-600" />
            </div>
            {recentBlocked.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500 sm:px-5">
                No IPs currently blocked.
              </p>
            ) : (
              <ul>
                {recentBlocked.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-start justify-between gap-3 border-t border-slate-800/70 px-4 py-2.5 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-slate-200">
                        {b.ipAddress}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {b.reason}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      {b.source}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-white">Your domains</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Recently added domains and SSL coverage.
            </p>
          </div>
          <Link
            href="/dashboard/domains"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            Manage domains
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentDomains.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500 sm:px-5">
            No domains yet. Add one to get started.
          </p>
        ) : (
          <ul>
            {recentDomains.map((domain) => (
              <li
                key={domain.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 px-4 py-3 first:border-t-0 sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-white">{domain.name}</p>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        domain.status === "ACTIVE"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {domain.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {domain._count.subdomains} subdomain
                    {domain._count.subdomains === 1 ? "" : "s"}
                    <span className="mx-1.5 text-slate-700">·</span>
                    {domain._count.sslCerts} SSL
                    <span className="mx-1.5 text-slate-700">·</span>
                    Added {formatDate(domain.createdAt)}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Link
                    href="/dashboard/dns"
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    DNS
                  </Link>
                  <Link
                    href="/dashboard/ssl"
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    SSL
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
