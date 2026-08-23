import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function HostServicesLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");
  return children;
}
