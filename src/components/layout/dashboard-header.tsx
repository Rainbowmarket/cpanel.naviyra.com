"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, X } from "lucide-react";
import { LogoutButton } from "@/components/layout/logout-button";
import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/utils";

const routeLabels: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/domains": "Domains",
  "/dashboard/subdomains": "Subdomains",
  "/dashboard/mail": "Mail",
  "/dashboard/ftp": "FTP",
  "/dashboard/databases": "Databases",
  "/dashboard/ssl": "SSL",
  "/dashboard/dns": "DNS",
  "/dashboard/security": "Security",
  "/dashboard/terminal": "Terminal",
  "/dashboard/users": "Users",
  "/dashboard/backups": "Backups",
  "/dashboard/speed-test": "Speed Test",
  "/dashboard/docs": "Docs",
  "/dashboard/files": "Files",
  "/file-manager": "File Manager",
};

function getBreadcrumbs(pathname: string) {
  if (pathname === "/dashboard") {
    return [{ href: "/dashboard", label: "Overview", current: true }];
  }

  if (pathname.startsWith("/dashboard/docs/")) {
    return [
      { href: "/dashboard", label: "Overview", current: false },
      { href: "/dashboard/docs", label: "Docs", current: false },
      { href: pathname, label: "Article", current: true },
    ];
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
  navOpen?: boolean;
  onToggleNav?: () => void;
};

export function DashboardHeader({
  name,
  email,
  role,
  navOpen = false,
  onToggleNav,
}: DashboardHeaderProps) {
  const pathname = usePathname();
  const crumbs = getBreadcrumbs(pathname);
  const roleLabel = role === "ADMIN" ? "Administrator" : "User";
  const currentLabel =
    crumbs.find((c) => c.current)?.label ?? routeLabels[pathname] ?? "Panel";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/80 px-3 backdrop-blur-sm sm:h-[4.5rem] sm:gap-6 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {onToggleNav ? (
          <button
            type="button"
            onClick={onToggleNav}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-200 transition hover:bg-slate-800 hover:text-white lg:hidden"
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
          >
            {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        ) : null}

        {/* Mobile: page title only (brand lives in the drawer) */}
        <div className="min-w-0 lg:hidden">
          <p className="truncate text-sm font-semibold text-white">
            {currentLabel}
          </p>
          <p className="truncate text-[11px] text-slate-500">{name}</p>
        </div>

        {/* Desktop breadcrumbs */}
        <nav aria-label="Breadcrumb" className="hidden min-w-0 lg:block">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm">
            {crumbs.map((crumb, index) => (
              <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                {index > 0 && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                )}
                {crumb.current ? (
                  <span className="truncate font-medium text-white">
                    {crumb.label}
                  </span>
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
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 md:flex">
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
        <LogoutButton />
      </div>
    </header>
  );
}
