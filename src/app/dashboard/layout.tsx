import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { LogoutButton } from "@/components/layout/logout-button";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-slate-900 text-slate-100">
      <Sidebar role={user.role} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-slate-800/80 px-8">
          <div className="leading-tight">
            <p className="text-xs text-slate-400">Signed in as</p>
            <p className="text-sm font-medium text-white">{user.name}</p>
          </div>
          <LogoutButton />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
