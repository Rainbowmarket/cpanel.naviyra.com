"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Globe,
  LayoutDashboard,
  Lock,
  Mail,
  FolderOpen,
  Server,
  Upload,
  ChevronRight,
  Users,
  Network,
  Shield,
  Terminal,
  Archive,
} from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: "Main",
    items: [{ href: "/dashboard", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Hosting",
    items: [
      { href: "/dashboard/domains", label: "Domains", icon: Globe },
      { href: "/dashboard/subdomains", label: "Subdomains", icon: Server },
    ],
  },
  {
    label: "Services",
    items: [
      { href: "/dashboard/mail", label: "Mail", icon: Mail },
      { href: "/dashboard/ftp", label: "FTP", icon: Upload },
      { href: "/dashboard/ssl", label: "SSL", icon: Lock },
      { href: "/dashboard/dns", label: "DNS", icon: Network },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/dashboard/files", label: "File Manager", icon: FolderOpen },
      { href: "/dashboard/security", label: "Security", icon: Shield },
      { href: "/dashboard/terminal", label: "Terminal", icon: Terminal },
    ],
  },
];

const adminNavGroup = {
  label: "Admin",
  items: [
    { href: "/dashboard/users", label: "Users", icon: Users },
    { href: "/dashboard/backups", label: "Backups", icon: Archive },
  ],
};

export function Sidebar({ role }: { role?: string }) {
  const pathname = usePathname();
  const groups = role === "ADMIN" ? [...navGroups, adminNavGroup] : navGroups;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r border-slate-800/80 bg-gradient-to-b from-slate-950 to-slate-900">
      <div className="flex h-[4.5rem] shrink-0 items-center border-b border-slate-800/80 px-5">
        <div className="flex items-center gap-3">
          <BrandLogo size={36} className="ring-1 ring-white/10" priority />
          <div className="leading-tight">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              Naviyra
            </p>
            <h1 className="text-sm font-semibold text-white">Hosting Panel</h1>
          </div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-3 py-5">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active =
                  !("external" in item && item.external) &&
                  (pathname === item.href ||
                    (item.href !== "/dashboard" && pathname.startsWith(item.href)));

                const className = cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-emerald-500/15 text-emerald-300 shadow-sm ring-1 ring-emerald-500/20"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
                );

                if ("external" in item && item.external) {
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={className}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-slate-300" />
                      <span className="flex-1">{item.label}</span>
                    </a>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={className}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"
                      )}
                    />
                    <span className="flex-1">{item.label}</span>
                    {active && <ChevronRight className="h-3.5 w-3.5 text-emerald-500/70" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800/80 px-5 py-4">
        <p className="text-xs text-slate-500">Naviyra Panel v0.1</p>
        <p className="mt-0.5 text-[10px] text-slate-600">Windows · Linux · macOS</p>
      </div>
    </aside>
  );
}
