import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getMailSession } from "@/lib/mail/session";
import {
  deleteMessage,
  ensureMailboxDirs,
  getFolderCounts,
  getMessage,
  listMessages,
  markMessageRead,
  moveMessage,
  removeMailboxData,
  resolveRestoreFolder,
  seedWelcomeMessage,
  sendMessage,
} from "@/lib/mail/store";
import type { MailFolder } from "@/lib/mail/types";
import { MAIL_FOLDERS } from "@/lib/mail/types";

async function getOwnedAccount(accountId: string, userId: string) {
  return prisma.mailAccount.findFirstOrThrow({
    where: { id: accountId, mailDomain: { domain: { userId } } },
    select: { id: true, email: true, isActive: true },
  });
}

/** Panel owner session or mailbox user session. */
export async function authorizeWebmail(accountId: string) {
  const mailSession = await getMailSession();
  if (mailSession?.accountId === accountId) {
    const account = await prisma.mailAccount.findFirst({
      where: { id: accountId, isActive: true },
      select: { id: true, email: true, isActive: true },
    });
    if (!account) throw new Error("Unauthorized");
    return account;
  }

  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");
  return getOwnedAccount(accountId, user.id);
}

export async function getWebmailAccount(accountId: string) {
  const account = await authorizeWebmail(accountId);
  if (!account.isActive) {
    throw new Error("Mailbox is deactivated");
  }
  await ensureMailboxDirs(account.email);
  await seedWelcomeMessage(account.email);
  return account;
}

export async function getWebmailOverview(accountId: string) {
  const account = await getWebmailAccount(accountId);
  const counts = await getFolderCounts(account.email);
  return { account, folders: MAIL_FOLDERS, counts };
}

export async function getWebmailMessages(accountId: string, folder: MailFolder) {
  const account = await getWebmailAccount(accountId);
  const messages = await listMessages(account.email, folder);
  return { account, messages };
}

export async function getWebmailMessage(
  accountId: string,
  folder: MailFolder,
  messageId: string
) {
  const account = await getWebmailAccount(accountId);
  const message = await getMessage(account.email, folder, messageId);
  if (!message) throw new Error("Message not found");
  if (!message.read) {
    await markMessageRead(account.email, folder, messageId, true);
    message.read = true;
  }
  return { account, message };
}

export async function composeWebmailMessage(
  accountId: string,
  input: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    draft?: boolean;
    draftId?: string;
  }
) {
  const account = await getWebmailAccount(accountId);
  const message = await sendMessage({
    fromEmail: account.email,
    ...input,
  });
  return { account, message };
}

export async function moveWebmailMessage(
  accountId: string,
  folder: MailFolder,
  messageId: string,
  targetFolder: MailFolder
) {
  const account = await getWebmailAccount(accountId);
  const message = await moveMessage(account.email, folder, targetFolder, messageId);
  if (!message) throw new Error("Message not found");
  return { account, message };
}

/** Restore from Trash/Junk to the folder the message came from (Sent, Inbox, …). */
export async function restoreWebmailMessage(
  accountId: string,
  folder: MailFolder,
  messageId: string
) {
  if (folder !== "Trash" && folder !== "Junk") {
    throw new Error("Restore is only available from Trash or Junk");
  }
  const account = await getWebmailAccount(accountId);
  const current = await getMessage(account.email, folder, messageId);
  if (!current) throw new Error("Message not found");
  const target = resolveRestoreFolder(current, account.email);
  const message = await moveMessage(account.email, folder, target, messageId);
  if (!message) throw new Error("Message not found");
  return { account, message, restoredTo: target };
}

export async function markWebmailMessageRead(
  accountId: string,
  folder: MailFolder,
  messageId: string,
  read = true
) {
  const account = await getWebmailAccount(accountId);
  const message = await markMessageRead(account.email, folder, messageId, read);
  if (!message) throw new Error("Message not found");
  return { account, message };
}

export async function deleteWebmailMessage(
  accountId: string,
  folder: MailFolder,
  messageId: string,
  permanent = false
) {
  const account = await getWebmailAccount(accountId);

  if (folder === "Trash" || permanent) {
    await deleteMessage(account.email, folder, messageId);
    return { account, ok: true };
  }

  await moveMessage(account.email, folder, "Trash", messageId);
  return { account, ok: true };
}

export async function initializeMailbox(email: string) {
  await ensureMailboxDirs(email);
  await seedWelcomeMessage(email);
}

export async function cleanupMailbox(email: string) {
  await removeMailboxData(email);
}

export function parseMailFolder(value: string): MailFolder | null {
  return MAIL_FOLDERS.includes(value as MailFolder) ? (value as MailFolder) : null;
}
