import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { DashboardHeader } from "@/components/layout/dashboard-header";

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
        <DashboardHeader name={user.name} email={user.email} role={user.role} />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
