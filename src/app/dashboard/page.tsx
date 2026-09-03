import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getDashboardOverview } from "@/lib/services/overview";
import { canAccessDashboardPath } from "@/lib/panel-permissions";
import { PageHeader } from "@/components/ui/page-header";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Globe,
  HardDrive,
  Lock,
  MemoryStick,
  Server,
  Shield,
  ShieldAlert,
} from "lucide-react";

function usedTone(pct: number | null) {
  if (pct == null) return "text-slate-400";
  if (pct >= 90) return "text-red-300";
  if (pct >= 80) return "text-amber-300";
  return "text-emerald-300";
}

function usedBar(pct: number | null) {
  if (pct == null) return "bg-slate-600";
  if (pct >= 90) return "bg-red-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

function Metric({
  label,
  value,
  hint,
  pct,
  href,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  pct: number | null;
  href: string;
  icon: typeof Activity;
}) {
  return (
    <Link
      href={href}
      className="panel-card-inset p-3 transition hover:border-slate-700"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          <Icon className="h-3.5 w-3.5 text-slate-500" />
          {label}
        </p>
        <span className={`text-sm font-semibold tabular-nums ${usedTone(pct)}`}>
          {value}
        </span>
      </div>
      {pct != null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full ${usedBar(pct)}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">{hint}</p>
      )}
      {pct != null && hint ? (
        <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>
      ) : null}
    </Link>
  );
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const overview = await getDashboardOverview({
    id: user.id,
    role: user.role,
  });

  const domainCount = await prisma.domain.count({
    where: user.role === "ADMIN" ? {} : { userId: user.id },
  });

  const drilldowns = [
    { label: "Domains", href: "/dashboard/domains" },
    { label: "Security", href: "/dashboard/security" },
    { label: "Monitoring", href: "/dashboard/monitoring" },
    { label: "SSL", href: "/dashboard/ssl" },
    { label: "Backups", href: "/dashboard/backups" },
  ].filter((item) => canAccessDashboardPath(user, item.href));

  const healthHref = canAccessDashboardPath(user, "/dashboard/monitoring")
    ? "/dashboard/monitoring"
    : "/dashboard";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={
          <>
            {overview.health.hostname}
            {domainCount
              ? ` · ${domainCount} site${domainCount === 1 ? "" : "s"}`
              : ""}
          </>
        }
        trailing={
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${
              overview.agentOnline
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                overview.agentOnline ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            Agent {overview.agentOnline ? "online" : "offline"}
          </div>
        }
      />

      {overview.alerts.length > 0 ? (
        <section className="rounded-xl border border-amber-500/25 bg-amber-500/5">
          <div className="flex items-center justify-between border-b border-amber-500/15 px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Alerts
            </h3>
            <span className="text-[11px] text-slate-500">{overview.alerts.length}</span>
          </div>
          <ul>
            {overview.alerts.map((alert) => (
              <li key={alert.id} className="border-t border-slate-800/60 first:border-t-0">
                <Link
                  href={alert.href}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-900/50"
                >
                  <span
                    className={
                      alert.tone === "critical" ? "text-red-300" : "text-amber-200"
                    }
                  >
                    {alert.title}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
          No critical alerts.
        </p>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Server health</h3>
          <Link
            href={healthHref}
            className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
          >
            Details
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metric
            label="CPU"
            value={
              overview.health.cpuPercent == null
                ? "—"
                : `${overview.health.cpuPercent}%`
            }
            pct={overview.health.cpuPercent}
            href={healthHref}
            icon={Activity}
          />
          <Metric
            label="RAM"
            value={
              overview.health.memPercent == null
                ? "—"
                : `${overview.health.memPercent}%`
            }
            hint={overview.health.memLabel}
            pct={overview.health.memPercent}
            href={healthHref}
            icon={MemoryStick}
          />
          <Metric
            label="Disk"
            value={
              overview.health.diskPercent == null
                ? "—"
                : `${overview.health.diskPercent}%`
            }
            hint={overview.health.diskLabel}
            pct={overview.health.diskPercent}
            href={healthHref}
            icon={HardDrive}
          />
          <Metric
            label="Uptime"
            value={overview.health.uptime}
            hint={overview.health.hostname}
            pct={null}
            href={healthHref}
            icon={Server}
          />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Services</h3>
          {canAccessDashboardPath(user, "/dashboard/services") ? (
            <Link
              href="/dashboard/services"
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              Start / stop
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : canAccessDashboardPath(user, "/dashboard/service-tests") ? (
            <Link
              href="/dashboard/service-tests"
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              Tests
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {overview.services.map((svc) => (
            <Link
              key={svc.id}
              href={
                canAccessDashboardPath(user, svc.href) ? svc.href : "/dashboard"
              }
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 hover:border-slate-700"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  svc.ok ? "bg-emerald-400" : "bg-red-500"
                }`}
              />
              <span className="text-sm text-slate-200">{svc.label}</span>
              <span className="ml-auto text-[11px] text-slate-500">
                {svc.ok ? "Up" : "Down"}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-950/60">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <Globe className="h-4 w-4 text-slate-500" />
              Top sites
            </h3>
            <Link
              href="/dashboard/domains"
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              All sites
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {overview.topSites.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              No traffic in the last 24 hours.
            </p>
          ) : (
            <ol>
              {overview.topSites.map((site, i) => (
                <li
                  key={site.id}
                  className="flex items-center justify-between gap-3 border-t border-slate-800/70 px-3 py-2 first:border-t-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-4 text-[11px] tabular-nums text-slate-600">
                      {i + 1}
                    </span>
                    <span className="truncate text-sm text-white">{site.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                    {site.hits.toLocaleString()} hits
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/60">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <Shield className="h-4 w-4 text-slate-500" />
              Security
            </h3>
            <Link
              href="/dashboard/security"
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              Details
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-800">
            <div className="bg-slate-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Firewall
              </p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  overview.security.firewallActive === false
                    ? "text-red-300"
                    : "text-emerald-300"
                }`}
              >
                {overview.security.firewallActive === null
                  ? "Host n/a"
                  : overview.security.firewallActive
                    ? "Active"
                    : "Inactive"}
              </p>
            </div>
            <div className="bg-slate-950/60 p-3">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500">
                <Lock className="h-3 w-3" />
                Failed logins
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {overview.security.failedLogins24h}
                <span className="ml-1 text-[11px] font-normal text-slate-500">
                  / 24h
                </span>
              </p>
            </div>
            <div className="bg-slate-950/60 p-3">
              <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500">
                <ShieldAlert className="h-3 w-3" />
                Threats
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {overview.security.threats24h}
                <span className="ml-1 text-[11px] font-normal text-slate-500">
                  / 24h
                </span>
              </p>
            </div>
            <div className="bg-slate-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Blocked IPs
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {overview.security.blockedIps}
              </p>
            </div>
          </div>
        </section>
      </div>

      <p className="flex flex-wrap gap-2 text-[11px] text-slate-500">
        {drilldowns.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md border border-slate-800 px-2 py-1 text-slate-400 hover:border-slate-700 hover:text-slate-200"
          >
            {item.label}
          </Link>
        ))}
      </p>
    </div>
  );
}
