import { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { canAccessDashboardPath } from "@/lib/panel-permissions";
import { ensureControllerNode } from "@/lib/agent/target";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureControllerNode();

  const pathname = (await headers()).get("x-naviyra-pathname") ?? "";
  if (pathname && !canAccessDashboardPath(user, pathname)) {
    redirect("/dashboard");
  }

  return (
    <DashboardShell
      role={user.role}
      name={user.name}
      email={user.email}
      permissionKeys={user.permissionKeys}
    >
      {children}
    </DashboardShell>
  );
}
