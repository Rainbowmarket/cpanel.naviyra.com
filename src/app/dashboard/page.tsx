import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { pingAgent } from "@/lib/agent/client";
import {
  getPermissionLabel,
  getPlatformName,
  hasAdminPermission,
} from "@/lib/permissions";
import { Globe, Lock, Mail, Shield, Upload } from "lucide-react";

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

  const [domainCount, mailCount, ftpCount, sslCount, agentOnline] =
    await Promise.all([
      prisma.domain.count({ where: { userId: user.id } }),
      prisma.mailAccount.count({
        where: { mailDomain: { domain: { userId: user.id } } },
      }),
      prisma.ftpAccount.count({ where: { domain: { userId: user.id } } }),
      prisma.sslCertificate.count({
        where: { domain: { userId: user.id }, status: "ACTIVE" },
      }),
      pingAgent(),
    ]);

  const stats = [
    { label: "Domains", value: domainCount, icon: Globe, href: "/dashboard/domains" },
    { label: "Mail Accounts", value: mailCount, icon: Mail, href: "/dashboard/mail" },
    { label: "FTP Accounts", value: ftpCount, icon: Upload, href: "/dashboard/ftp" },
    { label: "Active SSL", value: sslCount, icon: Lock, href: "/dashboard/ssl" },
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
    </div>
  );
}
