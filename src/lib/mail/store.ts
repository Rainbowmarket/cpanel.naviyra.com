import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import type { MailFolder, MailFolderCounts, MailMessage } from "./types";
import { MAIL_FOLDERS } from "./types";
import {
  buildRfc822,
  countMaildirFolder,
  deleteMaildirMessage,
  getMaildirMessage,
  listMaildirMessages,
  maildirExists,
  markMaildirRead,
  moveMaildirMessage,
  writeMaildirMessage,
} from "./maildir";
import {
  buildMailClientSettingsText,
  getMailClientHost,
  getPanelWebmailUrl,
} from "./client-settings";

export function getMailDataRoot(): string {
  return path.join(process.cwd(), "data", "mail");
}

function mailboxDir(email: string): string {
  return path.join(getMailDataRoot(), encodeURIComponent(email.toLowerCase()));
}

function folderDir(email: string, folder: MailFolder): string {
  return path.join(mailboxDir(email), folder);
}

function messagePath(email: string, folder: MailFolder, id: string): string {
  return path.join(folderDir(email, folder), `${id}.json`);
}

async function readMessageFile(
  email: string,
  folder: MailFolder,
  id: string
): Promise<MailMessage | null> {
  try {
    const raw = await fs.readFile(messagePath(email, folder, id), "utf8");
    return JSON.parse(raw) as MailMessage;
  } catch {
    return null;
  }
}

function stripMeta(message: MailMessage): MailMessage {
  const { ...rest } = message as MailMessage & Record<string, unknown>;
  delete rest._maildirFile;
  delete rest._maildirNew;
  return rest as MailMessage;
}

export async function ensureMailboxDirs(email: string): Promise<void> {
  const root = mailboxDir(email);
  await fs.mkdir(root, { recursive: true });
  for (const folder of MAIL_FOLDERS) {
    await fs.mkdir(path.join(root, folder), { recursive: true });
  }
}

export async function getFolderCounts(email: string): Promise<MailFolderCounts> {
  if (await maildirExists(email)) {
    const counts = {} as MailFolderCounts;
    for (const folder of MAIL_FOLDERS) {
      counts[folder] = await countMaildirFolder(email, folder);
    }
    return counts;
  }

  await ensureMailboxDirs(email);
  const counts = {} as MailFolderCounts;
  for (const folder of MAIL_FOLDERS) {
    const files = await fs.readdir(folderDir(email, folder));
    counts[folder] = files.filter((f) => f.endsWith(".json")).length;
  }
  return counts;
}

export async function listMessages(
  email: string,
  folder: MailFolder
): Promise<MailMessage[]> {
  if (await maildirExists(email)) {
    const messages = await listMaildirMessages(email, folder);
    return messages.map(stripMeta);
  }

  await ensureMailboxDirs(email);
  const dir = folderDir(email, folder);
  const files = await fs.readdir(dir);
  const messages = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (file) => {
        const raw = await fs.readFile(path.join(dir, file), "utf8");
        return JSON.parse(raw) as MailMessage;
      })
  );
  return messages.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export async function getMessage(
  email: string,
  folder: MailFolder,
  id: string
): Promise<MailMessage | null> {
  if (await maildirExists(email)) {
    const msg = await getMaildirMessage(email, folder, id);
    return msg ? stripMeta(msg) : null;
  }
  return readMessageFile(email, folder, id);
}

export async function saveMessage(
  email: string,
  message: MailMessage
): Promise<MailMessage> {
  if (await maildirExists(email)) {
    const raw = buildRfc822({
      from: message.from,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      body: message.body,
    });
    return stripMeta(
      await writeMaildirMessage(email, message.folder, raw, message.read)
    );
  }

  await ensureMailboxDirs(email);
  await fs.writeFile(
    messagePath(email, message.folder, message.id),
    JSON.stringify(message, null, 2),
    "utf8"
  );
  return message;
}

export async function deleteMessage(
  email: string,
  folder: MailFolder,
  id: string
): Promise<void> {
  if (await maildirExists(email)) {
    await deleteMaildirMessage(email, folder, id);
    return;
  }
  await fs.rm(messagePath(email, folder, id), { force: true });
}

export async function moveMessage(
  email: string,
  fromFolder: MailFolder,
  toFolder: MailFolder,
  id: string
): Promise<MailMessage | null> {
  if (await maildirExists(email)) {
    const moved = await moveMaildirMessage(email, fromFolder, toFolder, id);
    return moved ? stripMeta(moved) : null;
  }

  const message = await readMessageFile(email, fromFolder, id);
  if (!message) return null;

  await deleteMessage(email, fromFolder, id);
  const moved = { ...message, folder: toFolder };
  await saveMessage(email, moved);
  return moved;
}

export async function markMessageRead(
  email: string,
  folder: MailFolder,
  id: string,
  read: boolean
): Promise<MailMessage | null> {
  if (await maildirExists(email)) {
    const updated = await markMaildirRead(email, folder, id, read);
    return updated ? stripMeta(updated) : null;
  }

  const message = await readMessageFile(email, folder, id);
  if (!message) return null;
  const updated = { ...message, read };
  await saveMessage(email, updated);
  return updated;
}

async function sendViaPostfix(raw: string, fromEmail: string): Promise<void> {
  if (process.platform === "win32") {
    throw new Error("Outbound SMTP is only available on the Linux mail server");
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "/usr/sbin/sendmail",
      ["-t", "-i", "-f", fromEmail],
      { stdio: ["pipe", "ignore", "pipe"] }
    );
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `sendmail exited ${code}`));
    });
    child.stdin.write(raw);
    child.stdin.end();
  });
}

async function deliverLocal(recipientEmail: string, message: MailMessage) {
  const account = await prisma.mailAccount.findUnique({
    where: { email: recipientEmail.toLowerCase() },
  });
  if (!account || !account.isActive) return;

  if (await maildirExists(recipientEmail)) {
    const raw = buildRfc822({
      from: message.from,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      body: message.body,
    });
    await writeMaildirMessage(recipientEmail, "INBOX", raw, false);
    return;
  }

  await ensureMailboxDirs(recipientEmail);
  const incoming: MailMessage = {
    ...message,
    id: randomUUID(),
    folder: "INBOX",
    read: false,
    date: new Date().toISOString(),
  };
  await saveMessage(recipientEmail, incoming);
}

export async function sendMessage(input: {
  fromEmail: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  draft?: boolean;
  draftId?: string;
}): Promise<MailMessage> {
  const now = new Date().toISOString();
  const to = input.to.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const cc = (input.cc ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);

  if (!input.draft && to.length === 0) {
    throw new Error("Add at least one recipient in To");
  }

  if (input.draft) {
    if (input.draftId) {
      await deleteMessage(input.fromEmail, "Drafts", input.draftId).catch(() => {});
    }
    const draft: MailMessage = {
      id: input.draftId ?? randomUUID(),
      folder: "Drafts",
      from: input.fromEmail,
      to,
      cc,
      subject: input.subject,
      body: input.body,
      date: now,
      read: true,
    };
    return saveMessage(input.fromEmail, draft);
  }

  if (input.draftId) {
    await deleteMessage(input.fromEmail, "Drafts", input.draftId).catch(() => {});
  }

  const raw = buildRfc822({
    from: input.fromEmail,
    to,
    cc,
    subject: input.subject,
    body: input.body,
  });

  // Deliver through Postfix for real SMTP (local + remote)
  await sendViaPostfix(raw, input.fromEmail);

  if (await maildirExists(input.fromEmail)) {
    return stripMeta(await writeMaildirMessage(input.fromEmail, "Sent", raw, true));
  }

  const sent: MailMessage = {
    id: randomUUID(),
    folder: "Sent",
    from: input.fromEmail,
    to,
    cc,
    subject: input.subject,
    body: input.body,
    date: now,
    read: true,
  };
  await saveMessage(input.fromEmail, sent);
  return sent;
}

export async function seedWelcomeMessage(email: string): Promise<void> {
  if (await maildirExists(email)) {
    const inboxCount = await countMaildirFolder(email, "INBOX");
    if (inboxCount > 0) return;
  } else {
    await ensureMailboxDirs(email);
    const existing = await listMessages(email, "INBOX");
    if (existing.length > 0) return;
  }

  const domainName = email.includes("@") ? email.split("@")[1]! : "localhost";
  const mailHost = getMailClientHost(domainName);
  const panelUrl = getPanelWebmailUrl();

  await saveMessage(email, {
    id: randomUUID(),
    folder: "INBOX",
    from: "welcome@naviyra.com",
    to: [email],
    cc: [],
    subject: "Welcome to your Naviyra mailbox — client setup",
    body: buildMailClientSettingsText({ email, mailHost, panelUrl }),
    date: new Date().toISOString(),
    read: false,
  });
}

export async function removeMailboxData(email: string): Promise<void> {
  await fs.rm(mailboxDir(email), { recursive: true, force: true });
}
