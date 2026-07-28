/**
 * Read/write Dovecot Maildir under /var/mail/vhosts/<domain>/<user>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

function extractTextBody(raw: string): string {
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length < 2) return "";
  const headers = parseHeaders(raw);
  const body = parts.slice(1).join("\n\n");
  const ct = (headers["content-type"] ?? "text/plain").toLowerCase();

  if (ct.includes("multipart/")) {
    const boundaryMatch = ct.match(/boundary="?([^";]+)"?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1]!;
      const chunks = body.split(`--${boundary}`);
      for (const chunk of chunks) {
        if (!chunk || chunk.startsWith("--")) continue;
        const chunkHeaders = parseHeaders(chunk);
        const chunkCt = (chunkHeaders["content-type"] ?? "").toLowerCase();
        if (chunkCt.includes("text/plain")) {
          const idx = chunk.search(/\r?\n\r?\n/);
          let text = idx >= 0 ? chunk.slice(idx).trim() : chunk;
          const te = (chunkHeaders["content-transfer-encoding"] ?? "").toLowerCase();
          if (te === "base64") {
            try {
              text = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
            } catch {
              /* keep */
            }
          } else if (te === "quoted-printable") {
            text = text.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
              String.fromCharCode(parseInt(h, 16))
            );
          }
          return text.trim();
        }
      }
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
    text = text.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
  }
  return text.trim();
}

function fileToMessage(
  email: string,
  folder: MailFolder,
  fileName: string,
  raw: string,
  inNew: boolean
): MailMessage {
  const headers = parseHeaders(raw);
  const id = createHash("sha1").update(`${email}:${folder}:${fileName}`).digest("hex").slice(0, 24);
  const from = decodeMimeWord(headers.from ?? "(unknown)");
  const subject = decodeMimeWord(headers.subject ?? "(no subject)");
  const dateHeader = headers.date;
  const date = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
  const seen = /:2,[^:]*S/.test(fileName) || !inNew;

  return {
    id,
    folder,
    from: parseAddressList(from)[0] ? from : from,
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
    subject,
    body: extractTextBody(raw),
    date: Number.isNaN(Date.parse(date)) ? new Date().toISOString() : date,
    read: seen,
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
        messages.push(fileToMessage(email, folder, file, raw, sub === "new"));
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
  const raw = await fs.readFile(fromPath, "utf8");
  const destName = msg._maildirFile.includes(":2,")
    ? msg._maildirFile
    : `${msg._maildirFile}:2,`;
  const toPath = path.join(toBase, "cur", destName);
  await fs.writeFile(toPath, raw, "utf8");
  await fs.rm(fromPath, { force: true });
  return { ...msg, folder: toFolder, _maildirFile: destName, _maildirNew: false };
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
  return fileToMessage(email, folder, fileName, rawRfc822, !read);
}

export function buildRfc822(input: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}): string {
  const date = new Date().toUTCString();
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
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
