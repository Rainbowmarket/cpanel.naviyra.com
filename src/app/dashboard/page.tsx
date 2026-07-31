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
import {
  Activity,
  Ban,
  Eye,
  Globe,
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
  ]);

  const stats = [
    { label: "Domains", value: domainCount, icon: Globe, href: "/dashboard/domains" },
    { label: "Mail Accounts", value: mailCount, icon: Mail, href: "/dashboard/mail" },
    { label: "FTP Accounts", value: ftpCount, icon: Upload, href: "/dashboard/ftp" },
    { label: "Active SSL", value: sslCount, icon: Lock, href: "/dashboard/ssl" },
  ];

  const securityStats = [
    {
      label: "Visitors today",
      value: security.visitorsToday,
      icon: Eye,
      href: "/dashboard/security?tab=visitors",
    },
    {
      label: "Live now",
      value: security.liveNow,
      icon: Activity,
      href: "/dashboard/security?tab=visitors",
    },
    {
      label: "Threats today",
      value: security.threatsToday,
      icon: ShieldAlert,
      href: "/dashboard/security?tab=threats",
      alert: security.threatsToday > 0,
    },
    {
      label: "Blocked IPs",
      value: security.blockedIps,
      icon: Ban,
      href: "/dashboard/security?tab=blocked",
      alert: security.blockedIps > 0,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="mt-1 text-slate-400">
          Manage domains, mail, FTP, SSL, and files from one place.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${
            agentOnline
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-amber-500/10 text-amber-300"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              agentOnline ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          Agent {agentOnline ? "online" : "offline"}
        </div>

        <div
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm ${
            canManage
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-red-500/10 text-red-300"
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          {getPlatformName()} · {getPermissionLabel()}
          {!canManage && liveMode ? " (admin required)" : ""}
        </div>

        {!liveMode && (
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-300">
            Dry-run mode
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-xl border border-slate-800 bg-slate-950 p-5 transition-colors hover:border-emerald-500/30 hover:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{stat.label}</p>
                <Icon className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="mt-3 text-3xl font-bold text-white">{stat.value}</p>
            </Link>
          );
        })}
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Security overview</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Today&apos;s traffic and active blocks across your domains.
            </p>
          </div>
          <Link
            href="/dashboard/security"
            className="text-sm text-emerald-400 hover:text-emerald-300"
          >
            Open security →
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {securityStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Link
                key={stat.label}
                href={stat.href}
                className={`rounded-xl border bg-slate-950 p-5 transition-colors hover:bg-slate-900 ${
                  stat.alert
                    ? "border-amber-500/30 hover:border-amber-500/50"
                    : "border-slate-800 hover:border-emerald-500/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">{stat.label}</p>
                  <Icon
                    className={`h-4 w-4 ${
                      stat.alert ? "text-amber-400" : "text-emerald-400"
                    }`}
                  />
                </div>
                <p className="mt-3 text-3xl font-bold text-white">{stat.value}</p>
              </Link>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <p className="text-sm font-medium text-white">Recent threats</p>
              <ShieldAlert className="h-3.5 w-3.5 text-slate-500" />
            </div>
            {recentThreats.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No threats logged yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {recentThreats.map((t) => (
                  <li key={t.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-slate-200">
                          {t.ipAddress}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {t.threatType.replaceAll("_", " ")}
                          {t.domain?.name ? ` · ${t.domain.name}` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          t.severity === "CRITICAL" || t.severity === "HIGH"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {t.severity}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <p className="text-sm font-medium text-white">Active blocks</p>
              <Ban className="h-3.5 w-3.5 text-slate-500" />
            </div>
            {recentBlocked.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                No IPs currently blocked.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {recentBlocked.map((b) => (
                  <li key={b.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-slate-200">
                          {b.ipAddress}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {b.reason}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        {b.source}
                      </span>
                    </div>
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
