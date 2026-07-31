/**
 * Read/write Dovecot Maildir under /var/mail/vhosts/<domain>/<user>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simpleParser } from "mailparser";
import type { MailFolder, MailMessage } from "./types";

const exec = promisify(execFile);
const VHOSTS = process.env.MAIL_VHOSTS_DIR?.trim() || "/var/mail/vhosts";
const VMAIL_UID = Number(process.env.MAIL_VMAIL_UID ?? 5000);
const VMAIL_GID = Number(process.env.MAIL_VMAIL_GID ?? 5000);

export function maildirHome(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) throw new Error(`Invalid email: ${email}`);
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  return path.join(VHOSTS, domain, local);
}

function folderRel(folder: MailFolder): string {
  return folder === "INBOX" ? "" : `.${folder}`;
}

export function maildirFolderPath(email: string, folder: MailFolder): string {
  const home = maildirHome(email);
  const rel = folderRel(folder);
  return rel ? path.join(home, rel) : home;
}

export async function maildirExists(email: string): Promise<boolean> {
  try {
    await fs.access(maildirHome(email));
    return true;
  } catch {
    return false;
  }
}

async function ensureMaildirFolder(email: string, folder: MailFolder) {
  const base = maildirFolderPath(email, folder);
  await fs.mkdir(path.join(base, "cur"), { recursive: true });
  await fs.mkdir(path.join(base, "new"), { recursive: true });
  await fs.mkdir(path.join(base, "tmp"), { recursive: true });
  if (process.platform !== "win32") {
    try {
      await exec("chown", [
        "-R",
        `${VMAIL_UID}:${VMAIL_GID}`,
        maildirHome(email),
      ]);
    } catch {
      /* ignore on non-root / missing chown */
    }
  }
}

function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => {
      const m = part.match(/<([^>]+)>/);
      return (m?.[1] ?? part).trim().toLowerCase();
    })
    .filter(Boolean);
}

function decodeMimeWord(input: string): string {
  return input.replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g,
    (_, _charset, enc, text: string) => {
      if (enc.toUpperCase() === "B") {
        try {
          return Buffer.from(text, "base64").toString("utf8");
        } catch {
          return text;
        }
      }
      // quoted-printable style Q encoding
      const q = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (__: string, h: string) =>
        String.fromCharCode(parseInt(h, 16))
      );
      return q;
    }
  );
}

function parseHeaders(raw: string): Record<string, string> {
  const headerPart = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const unfolded = headerPart.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    headers[key] = headers[key] ? `${headers[key]} ${value}` : value;
  }
  return headers;
}

const ORIGINAL_FOLDER_HEADER = "X-Naviyra-Original-Folder";

function isMailFolder(value: string | undefined): value is MailFolder {
  return Boolean(
    value &&
      ["INBOX", "Drafts", "Sent", "Trash", "Archive", "Junk"].includes(value)
  );
}

/** Set or replace a top-level header in an RFC822 message. */
export function setRfc822Header(raw: string, name: string, value: string): string {
  const sep = raw.search(/\r?\n\r?\n/);
  const headerBlock = sep >= 0 ? raw.slice(0, sep) : raw;
  const body = sep >= 0 ? raw.slice(sep) : "\r\n\r\n";
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*(?:\\r?\\n[ \\t].*)*\\r?\\n?`, "im");
  let nextHeaders = headerBlock.replace(re, "");
  if (!nextHeaders.endsWith("\n")) nextHeaders += "\r\n";
  nextHeaders += `${name}: ${value}\r\n`;
  return nextHeaders + body.replace(/^\r?\n\r?\n/, "\r\n\r\n");
}

export function removeRfc822Header(raw: string, name: string): string {
  const sep = raw.search(/\r?\n\r?\n/);
  const headerBlock = sep >= 0 ? raw.slice(0, sep) : raw;
  const body = sep >= 0 ? raw.slice(sep) : "\r\n\r\n";
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*(?:\\r?\\n[ \\t].*)*\\r?\\n?`, "im");
  const nextHeaders = headerBlock.replace(re, "");
  return nextHeaders + body.replace(/^\r?\n\r?\n/, "\r\n\r\n");
}

function decodeQuotedPrintable(input: string): string {
  const softStripped = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < softStripped.length; i++) {
    if (softStripped[i] === "=" && /^[0-9A-Fa-f]{2}/.test(softStripped.slice(i + 1, i + 3))) {
      bytes.push(parseInt(softStripped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(softStripped.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fallback when mailparser fails — preserves boundary case and UTF-8 QP. */
function extractTextBodyFallback(raw: string): string {
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length < 2) return "";
  const headers = parseHeaders(raw);
  const body = parts.slice(1).join("\n\n");
  const ctRaw = headers["content-type"] ?? "text/plain";
  const ct = ctRaw.toLowerCase();

  if (ct.includes("multipart/")) {
    // Boundary values are case-sensitive — extract from original header.
    const boundaryMatch = ctRaw.match(/boundary\s*=\s*"?([^";\s]+)"?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1]!;
      const chunks = body.split(`--${boundary}`);
      let htmlFallback = "";
      for (const chunk of chunks) {
        if (!chunk || chunk.trim() === "--" || chunk.startsWith("--")) continue;
        const chunkHeaders = parseHeaders(chunk);
        const chunkCt = (chunkHeaders["content-type"] ?? "").toLowerCase();
        const idx = chunk.search(/\r?\n\r?\n/);
        let text = idx >= 0 ? chunk.slice(idx).replace(/^\r?\n/, "").trim() : chunk.trim();
        const te = (chunkHeaders["content-transfer-encoding"] ?? "").toLowerCase();
        if (te === "base64") {
          try {
            text = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
          } catch {
            /* keep */
          }
        } else if (te === "quoted-printable") {
          text = decodeQuotedPrintable(text);
        }
        if (chunkCt.includes("text/plain")) return text.trim();
        if (chunkCt.includes("text/html") && !htmlFallback) {
          htmlFallback = htmlToPlainText(text);
        }
      }
      if (htmlFallback) return htmlFallback;
    }
  }

  let text = body;
  const te = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (te === "base64") {
    try {
      text = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      /* keep */
    }
  } else if (te === "quoted-printable") {
    text = decodeQuotedPrintable(text);
  }
  if (ct.includes("text/html")) return htmlToPlainText(text);
  return text.trim();
}

async function extractTextBody(raw: string): Promise<string> {
  try {
    const parsed = await simpleParser(Buffer.from(raw));
    if (parsed.text?.trim()) return parsed.text.trim();
    if (typeof parsed.html === "string" && parsed.html.trim()) {
      return htmlToPlainText(parsed.html);
    }
  } catch {
    /* fall through */
  }
  return extractTextBodyFallback(raw);
}

async function fileToMessage(
  email: string,
  folder: MailFolder,
  fileName: string,
  raw: string,
  inNew: boolean
): Promise<MailMessage> {
  const headers = parseHeaders(raw);
  const id = createHash("sha1").update(`${email}:${folder}:${fileName}`).digest("hex").slice(0, 24);
  const from = decodeMimeWord(headers.from ?? "(unknown)")
    .replace(/<{2,}/g, "<")
    .replace(/>{2,}/g, ">");
  const subject = decodeMimeWord(headers.subject ?? "(no subject)");
  const dateHeader = headers.date;
  const date = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
  const seen = /:2,[^:]*S/.test(fileName) || !inNew;

  const originalRaw = headers["x-naviyra-original-folder"];
  const originalFolder = isMailFolder(originalRaw) ? originalRaw : undefined;

  return {
    id,
    folder,
    from: parseAddressList(from)[0] ? from : from,
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
    bcc: parseAddressList(headers.bcc),
    subject,
    body: await extractTextBody(raw),
    date: Number.isNaN(Date.parse(date)) ? new Date().toISOString() : date,
    read: seen,
    originalFolder,
    _maildirFile: fileName,
    _maildirNew: inNew,
  } as MailMessage & { _maildirFile?: string; _maildirNew?: boolean };
}

type MaildirMeta = { _maildirFile?: string; _maildirNew?: boolean };

async function listDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export async function listMaildirMessages(
  email: string,
  folder: MailFolder
): Promise<MailMessage[]> {
  if (!(await maildirExists(email))) return [];
  await ensureMaildirFolder(email, folder);
  const base = maildirFolderPath(email, folder);
  const messages: MailMessage[] = [];

  for (const sub of ["new", "cur"] as const) {
    const dir = path.join(base, sub);
    const files = await listDirSafe(dir);
    for (const file of files) {
      if (file.startsWith(".")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), "utf8");
        messages.push(await fileToMessage(email, folder, file, raw, sub === "new"));
      } catch {
        /* skip unreadable */
      }
    }
  }

  return messages.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export async function getMaildirMessage(
  email: string,
  folder: MailFolder,
  id: string
): Promise<(MailMessage & MaildirMeta) | null> {
  const all = await listMaildirMessages(email, folder);
  return (all.find((m) => m.id === id) as (MailMessage & MaildirMeta) | undefined) ?? null;
}

export async function countMaildirFolder(
  email: string,
  folder: MailFolder
): Promise<number> {
  if (!(await maildirExists(email))) return 0;
  const base = maildirFolderPath(email, folder);
  const newer = await listDirSafe(path.join(base, "new"));
  const cur = await listDirSafe(path.join(base, "cur"));
  return [...newer, ...cur].filter((f) => !f.startsWith(".")).length;
}

export async function markMaildirRead(
  email: string,
  folder: MailFolder,
  id: string,
  read: boolean
): Promise<MailMessage | null> {
  const msg = await getMaildirMessage(email, folder, id);
  if (!msg?._maildirFile) return null;

  const base = maildirFolderPath(email, folder);
  const fromSub = msg._maildirNew ? "new" : "cur";
  const fromPath = path.join(base, fromSub, msg._maildirFile);

  let name = msg._maildirFile.replace(/:2,[^:]*$/, "");
  if (read) {
    if (!name.includes(":2,")) name = `${name}:2,S`;
    else if (!/S/.test(name.split(":2,")[1] ?? "")) {
      name = name.replace(/:2,/, ":2,S");
    }
  } else {
    name = name.replace(/:2,[^:]*$/, "").replace(/:2,S/, ":2,");
    if (name.includes(":2,") && (name.split(":2,")[1] ?? "") === "") {
      name = name.replace(/:2,$/, "");
    }
  }

  const toPath = path.join(base, "cur", name);
  try {
    await fs.rename(fromPath, toPath);
  } catch {
    return msg;
  }
  return { ...msg, read, _maildirFile: name, _maildirNew: false };
}

export async function deleteMaildirMessage(
  email: string,
  folder: MailFolder,
  id: string
): Promise<boolean> {
  const msg = await getMaildirMessage(email, folder, id);
  if (!msg?._maildirFile) return false;
  const base = maildirFolderPath(email, folder);
  const sub = msg._maildirNew ? "new" : "cur";
  await fs.rm(path.join(base, sub, msg._maildirFile), { force: true });
  return true;
}

export async function moveMaildirMessage(
  email: string,
  fromFolder: MailFolder,
  toFolder: MailFolder,
  id: string
): Promise<MailMessage | null> {
  const msg = await getMaildirMessage(email, fromFolder, id);
  if (!msg?._maildirFile) return null;

  await ensureMaildirFolder(email, toFolder);
  const fromBase = maildirFolderPath(email, fromFolder);
  const toBase = maildirFolderPath(email, toFolder);
  const fromSub = msg._maildirNew ? "new" : "cur";
  const fromPath = path.join(fromBase, fromSub, msg._maildirFile);
  let raw = await fs.readFile(fromPath, "utf8");

  // Remember source folder when moving into Trash/Junk so Restore can return it.
  if (
    (toFolder === "Trash" || toFolder === "Junk") &&
    fromFolder !== "Trash" &&
    fromFolder !== "Junk"
  ) {
    const keep = msg.originalFolder ?? fromFolder;
    raw = setRfc822Header(raw, ORIGINAL_FOLDER_HEADER, keep);
  }

  // Clear marker when leaving Trash/Junk via restore.
  if (
    (fromFolder === "Trash" || fromFolder === "Junk") &&
    toFolder !== "Trash" &&
    toFolder !== "Junk"
  ) {
    raw = removeRfc822Header(raw, ORIGINAL_FOLDER_HEADER);
  }

  const destName = msg._maildirFile.includes(":2,")
    ? msg._maildirFile
    : `${msg._maildirFile}:2,`;
  const toPath = path.join(toBase, "cur", destName);
  await fs.writeFile(toPath, raw, "utf8");
  await fs.rm(fromPath, { force: true });
  return fileToMessage(email, toFolder, destName, raw, false);
}

export async function writeMaildirMessage(
  email: string,
  folder: MailFolder,
  rawRfc822: string,
  read = true
): Promise<MailMessage> {
  await ensureMaildirFolder(email, folder);
  const base = maildirFolderPath(email, folder);
  const ts = Math.floor(Date.now() / 1000);
  const rand = randomBytes(4).toString("hex");
  const flags = read ? ":2,S" : "";
  const fileName = `${ts}.M${process.pid}P${rand}.naviyra${flags}`;
  const sub = read ? "cur" : "new";
  const fullPath = path.join(base, sub, fileName);
  await fs.writeFile(fullPath, rawRfc822, "utf8");
  if (process.platform !== "win32") {
    try {
      await exec("chown", [`${VMAIL_UID}:${VMAIL_GID}`, fullPath]);
    } catch {
      /* ignore */
    }
  }
  return await fileToMessage(email, folder, fileName, rawRfc822, !read);
}


export function buildRfc822(input: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}): string {
  const date = new Date().toUTCString();
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${input.subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body.replace(/\r?\n/g, "\n"),
    "",
  ];
  return lines.join("\r\n");
}
