import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function MailboxLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { accountId } = await params;
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, mailDomain: { domain: { userId: user.id } } },
    select: { email: true, isActive: true },
  });

  if (!account) redirect("/dashboard/mail");
  if (!account.isActive) redirect("/dashboard/mail");

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      {children}
    </div>
  );
}
