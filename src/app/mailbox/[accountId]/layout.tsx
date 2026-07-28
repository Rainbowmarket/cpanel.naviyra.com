import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getMailSession } from "@/lib/mail/session";
import { prisma } from "@/lib/prisma";

export default async function MailboxLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const mailSession = await getMailSession();
  const panelUser = await getSessionUser();

  if (mailSession?.accountId === accountId) {
    const account = await prisma.mailAccount.findFirst({
      where: { id: accountId, isActive: true },
      select: { email: true },
    });
    if (!account) redirect("/webmail");
    return (
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
        {children}
      </div>
    );
  }

  if (!panelUser) redirect("/webmail");

  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, mailDomain: { domain: { userId: panelUser.id } } },
    select: { email: true, isActive: true },
  });

  if (!account) redirect("/webmail");
  if (!account.isActive) redirect("/webmail");

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      {children}
    </div>
  );
}
