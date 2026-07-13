import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function FileManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-slate-900 text-slate-100">
      {children}
    </div>
  );
}
