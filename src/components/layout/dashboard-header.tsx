"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { LogoutButton } from "@/components/layout/logout-button";
import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/utils";

const routeLabels: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/domains": "Domains",
  "/dashboard/subdomains": "Subdomains",
  "/dashboard/mail": "Mail",
  "/dashboard/ftp": "FTP",
  "/dashboard/ssl": "SSL",
  "/dashboard/dns": "DNS",
  "/dashboard/security": "Security",
  "/dashboard/terminal": "Terminal",
  "/dashboard/users": "Users",
  "/dashboard/backups": "Backups",
  "/dashboard/files": "Files",
  "/file-manager": "File Manager",
};

function getBreadcrumbs(pathname: string) {
  if (pathname === "/dashboard") {
    return [{ href: "/dashboard", label: "Overview", current: true }];
  }

  const label = routeLabels[pathname];
  if (!label) {
    return [{ href: "/dashboard", label: "Overview", current: false }];
  }

  return [
    { href: "/dashboard", label: "Overview", current: false },
    { href: pathname, label, current: true },
  ];
}

type DashboardHeaderProps = {
  name: string;
  email: string;
  role: string;
};

export function DashboardHeader({ name, email, role }: DashboardHeaderProps) {
  const pathname = usePathname();
  const crumbs = getBreadcrumbs(pathname);
  const roleLabel = role === "ADMIN" ? "Administrator" : "User";

  return (
    <header className="flex h-[4.5rem] shrink-0 items-center justify-between gap-6 border-b border-slate-800/80 bg-slate-950/50 px-8 backdrop-blur-sm">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm">
          {crumbs.map((crumb, index) => (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
              )}
              {crumb.current ? (
                <span className="truncate font-medium text-white">{crumb.label}</span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-slate-500 transition hover:text-emerald-400"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 sm:flex">
          <BrandLogo size={36} className="ring-1 ring-white/10" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium text-white">{name}</p>
            <p className="truncate text-[11px] text-slate-500">{email}</p>
          </div>
          <span
            className={cn(
              "ml-1 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
              role === "ADMIN"
                ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
                : "bg-slate-800 text-slate-400 ring-slate-700"
            )}
          >
            {roleLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:hidden">
          <BrandLogo size={36} className="ring-1 ring-white/10" />
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
