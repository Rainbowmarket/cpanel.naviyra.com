import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import type { MailAttachmentPayload, MailFolder, MailFolderCounts, MailMessage } from "./types";
import { MAIL_FOLDERS } from "./types";
import {
  buildRfc822,
  countMaildirFolder,
  deleteMaildirMessage,
  getMaildirAttachment,
  getMaildirMessage,
  listMaildirMessages,
  maildirExists,
  maildirHome,
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
  const rest = { ...message } as MailMessage & Record<string, unknown>;
  delete rest._maildirFile;
  delete rest._maildirNew;
  if (rest.attachments) {
    rest.attachments = rest.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    }));
  }
  return rest as MailMessage;
}

const MAX_MAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_MAIL_ATTACHMENTS = 10;

function rfcAttachmentsFromPayload(payloads?: MailAttachmentPayload[]) {
  const list = payloads ?? [];
  if (list.length > MAX_MAIL_ATTACHMENTS) {
    throw new Error(`At most ${MAX_MAIL_ATTACHMENTS} files can be attached`);
  }
  let total = 0;
  return list.map((p) => {
    const filename = (p.filename || "attachment").replace(/[/\\]/g, "_");
    const content = Buffer.from(p.contentBase64 || "", "base64");
    total += content.length;
    if (total > MAX_MAIL_ATTACHMENT_BYTES) {
      throw new Error("Attachments are larger than 20 MB in total");
    }
    return {
      filename,
      contentType: p.contentType || "application/octet-stream",
      content,
    };
  });
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
        return stripMeta(JSON.parse(raw) as MailMessage);
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
  const stored = await readMessageFile(email, folder, id);
  return stored ? stripMeta(stored) : null;
}

export async function getMessageAttachment(
  email: string,
  folder: MailFolder,
  id: string,
  index: number
): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  if (await maildirExists(email)) {
    return getMaildirAttachment(email, folder, id, index);
  }
  try {
    const raw = await fs.readFile(messagePath(email, folder, id), "utf8");
    const parsed = JSON.parse(raw) as {
      attachmentPayloads?: MailAttachmentPayload[];
    };
    const payload = parsed.attachmentPayloads?.[index];
    if (!payload?.contentBase64) return null;
    return {
      filename: payload.filename.replace(/[/\\]/g, "_"),
      contentType: payload.contentType || "application/octet-stream",
      content: Buffer.from(payload.contentBase64, "base64"),
    };
  } catch {
    return null;
  }
}

export async function saveMessage(
  email: string,
  message: MailMessage,
  payloads?: MailAttachmentPayload[]
): Promise<MailMessage> {
  if (await maildirExists(email)) {
    const raw = buildRfc822({
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      body: message.body,
      attachments: rfcAttachmentsFromPayload(payloads),
    });
    return stripMeta(
      await writeMaildirMessage(email, message.folder, raw, message.read)
    );
  }

  await ensureMailboxDirs(email);
  const stored: MailMessage = {
    ...message,
    attachments: (payloads ?? []).map((p) => ({
      filename: p.filename,
      contentType: p.contentType || "application/octet-stream",
      size: Buffer.from(p.contentBase64 || "", "base64").length,
    })),
  };
  const json = {
    ...stored,
    attachmentPayloads: payloads,
  };
  await fs.writeFile(
    messagePath(email, message.folder, message.id),
    JSON.stringify(json, null, 2),
    "utf8"
  );
  return stripMeta(stored);
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

  let originalFolder = message.originalFolder;
  if (
    (toFolder === "Trash" || toFolder === "Junk") &&
    fromFolder !== "Trash" &&
    fromFolder !== "Junk"
  ) {
    originalFolder = message.originalFolder ?? fromFolder;
  }
  if (
    (fromFolder === "Trash" || fromFolder === "Junk") &&
    toFolder !== "Trash" &&
    toFolder !== "Junk"
  ) {
    originalFolder = undefined;
  }

  const moved: MailMessage = {
    ...message,
    folder: toFolder,
    originalFolder,
  };
  await saveMessage(email, moved);
  return moved;
}

/** Resolve restore target for a Trash/Junk message. */
export function resolveRestoreFolder(
  message: MailMessage,
  accountEmail: string
): MailFolder {
  if (
    message.originalFolder &&
    message.originalFolder !== "Trash" &&
    message.originalFolder !== "Junk"
  ) {
    return message.originalFolder;
  }
  // Fallback for older trash items without a marker: Sent if we sent it.
  const from = message.from.match(/<([^>]+)>/)?.[1] ?? message.from;
  if (from.trim().toLowerCase() === accountEmail.trim().toLowerCase()) {
    return "Sent";
  }
  return "INBOX";
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
      bcc: message.bcc,
      subject: message.subject,
      body: message.body,
      attachments: rfcAttachmentsFromPayload(
        (message as MailMessage & { attachmentPayloads?: MailAttachmentPayload[] })
          .attachmentPayloads
      ),
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
  bcc?: string[];
  subject: string;
  body: string;
  draft?: boolean;
  draftId?: string;
  attachments?: MailAttachmentPayload[];
}): Promise<MailMessage> {
  const now = new Date().toISOString();
  const to = input.to.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const cc = (input.cc ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const bcc = (input.bcc ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const attachments = rfcAttachmentsFromPayload(input.attachments);
  const payloads = input.attachments;
  const attachmentMeta = attachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    size: a.content.length,
  }));

  if (!input.draft && to.length === 0 && cc.length === 0 && bcc.length === 0) {
    throw new Error("Add at least one recipient");
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
      bcc,
      subject: input.subject,
      body: input.body,
      date: now,
      read: true,
      attachments: attachmentMeta.length ? attachmentMeta : undefined,
    };
    return saveMessage(input.fromEmail, draft, payloads);
  }

  if (input.draftId) {
    await deleteMessage(input.fromEmail, "Drafts", input.draftId).catch(() => {});
  }

  const raw = buildRfc822({
    from: input.fromEmail,
    to,
    cc,
    bcc,
    subject: input.subject,
    body: input.body,
    attachments,
  });

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
    bcc,
    subject: input.subject,
    body: input.body,
    date: now,
    read: true,
    attachments: attachmentMeta.length ? attachmentMeta : undefined,
  };
  return saveMessage(input.fromEmail, sent, payloads);
}

export async function seedWelcomeMessage(email: string): Promise<void> {
  const markerRoot =
    (await maildirExists(email)) ? maildirHome(email) : mailboxDir(email);
  const markerPath = path.join(markerRoot, ".naviyra-welcome");

  try {
    await fs.access(markerPath);
    return; // Already offered once — do not recreate after delete
  } catch {
    /* no marker yet */
  }

  if (await maildirExists(email)) {
    const inboxCount = await countMaildirFolder(email, "INBOX");
    if (inboxCount > 0) {
      // Inbox already has mail; never inject welcome later
      await fs.mkdir(markerRoot, { recursive: true });
      await fs.writeFile(markerPath, new Date().toISOString(), "utf8");
      return;
    }
  } else {
    await ensureMailboxDirs(email);
    const existing = await listMessages(email, "INBOX");
    if (existing.length > 0) {
      await fs.writeFile(markerPath, new Date().toISOString(), "utf8");
      return;
    }
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

  await fs.mkdir(markerRoot, { recursive: true });
  await fs.writeFile(markerPath, new Date().toISOString(), "utf8");
}

export async function removeMailboxData(email: string): Promise<void> {
  await fs.rm(mailboxDir(email), { recursive: true, force: true });
}
