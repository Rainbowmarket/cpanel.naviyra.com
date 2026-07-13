import { prisma } from "@/lib/prisma";
import {
  deleteMessage,
  ensureMailboxDirs,
  getFolderCounts,
  getMessage,
  listMessages,
  markMessageRead,
  moveMessage,
  removeMailboxData,
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

export async function getWebmailAccount(accountId: string, userId: string) {
  const account = await getOwnedAccount(accountId, userId);
  if (!account.isActive) {
    throw new Error("Mailbox is deactivated");
  }
  await ensureMailboxDirs(account.email);
  await seedWelcomeMessage(account.email);
  return account;
}

export async function getWebmailOverview(accountId: string, userId: string) {
  const account = await getWebmailAccount(accountId, userId);
  const counts = await getFolderCounts(account.email);
  return { account, folders: MAIL_FOLDERS, counts };
}

export async function getWebmailMessages(
  accountId: string,
  userId: string,
  folder: MailFolder
) {
  const account = await getWebmailAccount(accountId, userId);
  const messages = await listMessages(account.email, folder);
  return { account, messages };
}

export async function getWebmailMessage(
  accountId: string,
  userId: string,
  folder: MailFolder,
  messageId: string
) {
  const account = await getWebmailAccount(accountId, userId);
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
  userId: string,
  input: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    draft?: boolean;
    draftId?: string;
  }
) {
  const account = await getWebmailAccount(accountId, userId);
  const message = await sendMessage({
    fromEmail: account.email,
    ...input,
  });
  return { account, message };
}

export async function moveWebmailMessage(
  accountId: string,
  userId: string,
  folder: MailFolder,
  messageId: string,
  targetFolder: MailFolder
) {
  const account = await getWebmailAccount(accountId, userId);
  const message = await moveMessage(account.email, folder, targetFolder, messageId);
  if (!message) throw new Error("Message not found");
  return { account, message };
}

export async function deleteWebmailMessage(
  accountId: string,
  userId: string,
  folder: MailFolder,
  messageId: string,
  permanent = false
) {
  const account = await getWebmailAccount(accountId, userId);

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
