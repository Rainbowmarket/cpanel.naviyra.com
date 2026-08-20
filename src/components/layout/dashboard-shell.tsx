"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { DashboardHeader } from "@/components/layout/dashboard-header";

type DashboardShellProps = {
  role: string;
  name: string;
  email: string;
  permissionKeys: string[] | null;
  children: ReactNode;
};

export function DashboardShell({
  role,
  name,
  email,
  permissionKeys,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    closeNav();
  }, [pathname, closeNav]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNav();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [navOpen, closeNav]);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-slate-900 text-slate-100">
      {/* Desktop sidebar */}
      <div className="hidden h-full lg:block">
        <Sidebar role={role} permissionKeys={permissionKeys} />
      </div>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-50 lg:hidden ${navOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!navOpen}
      >
        <button
          type="button"
          aria-label="Close menu"
          className={`absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] transition-opacity duration-200 ${
            navOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={closeNav}
        />
        <div
          className={`absolute inset-y-0 left-0 flex w-[min(18.5rem,88vw)] max-w-full transform transition-transform duration-200 ease-out ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            role={role}
            permissionKeys={permissionKeys}
            onNavigate={closeNav}
            showClose
            onClose={closeNav}
          />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <DashboardHeader
          name={name}
          email={email}
          role={role}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((o) => !o)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
