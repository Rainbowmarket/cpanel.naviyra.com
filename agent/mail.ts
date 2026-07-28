/**
 * Virtual mailbox management for Postfix + Dovecot (Linux).
 * Layout:
 *   /var/mail/vhosts/<domain>/<local>/
 *   /etc/postfix/virtual_mailbox_domains  (hash)
 *   /etc/postfix/virtual_mailbox_maps     (hash)
 *   /etc/dovecot/users                   (passwd-file)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const VMAIL_UID = 5000;
const VMAIL_GID = 5000;
const VHOSTS = "/var/mail/vhosts";
const POSTFIX_DOMAINS = "/etc/postfix/virtual_mailbox_domains";
const POSTFIX_MAILBOXES = "/etc/postfix/virtual_mailbox_maps";
const DOVECOT_USERS = "/etc/dovecot/users";

function splitEmail(email: string): { local: string; domain: string } {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) {
    throw new Error(`Invalid email: ${email}`);
  }
  return {
    local: normalized.slice(0, at),
    domain: normalized.slice(at + 1),
  };
}

function mailboxRelPath(email: string): string {
  const { local, domain } = splitEmail(email);
  return `${domain}/${local}/`;
}

function mailboxAbsPath(email: string): string {
  return path.join(VHOSTS, splitEmail(email).domain, splitEmail(email).local);
}

async function readLines(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

async function writeLines(filePath: string, lines: string[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const unique = Array.from(new Set(lines.filter(Boolean))).sort();
  await fs.writeFile(filePath, `${unique.join("\n")}\n`, "utf8");
}

async function postmap(filePath: string) {
  await exec("postmap", [filePath]);
}

async function reloadMail() {
  await exec("postfix", ["reload"]);
  await exec("systemctl", ["reload", "dovecot"]);
}

async function hashPassword(password: string): Promise<string> {
  const { stdout } = await exec("doveadm", ["pw", "-s", "SHA512-CRYPT", "-p", password]);
  return stdout.trim();
}

async function upsertDovecotUser(
  email: string,
  passwordHash: string | "*",
  dryRun: boolean
) {
  const { domain, local } = splitEmail(email);
  const home = `/var/mail/vhosts/${domain}/${local}`;
  const line = `${email}:${passwordHash}:${VMAIL_UID}:${VMAIL_GID}::${home}::`;
  const lines = await readLines(DOVECOT_USERS);
  const next = lines.filter((l) => !l.toLowerCase().startsWith(`${email.toLowerCase()}:`));
  next.push(line);
  if (!dryRun) {
    await writeLines(DOVECOT_USERS, next);
  }
}

async function removeDovecotUser(email: string, dryRun: boolean) {
  const lines = await readLines(DOVECOT_USERS);
  const next = lines.filter((l) => !l.toLowerCase().startsWith(`${email.toLowerCase()}:`));
  if (!dryRun) {
    await writeLines(DOVECOT_USERS, next);
  }
}

async function ensureDomain(domain: string, dryRun: boolean) {
  const lines = await readLines(POSTFIX_DOMAINS);
  if (!lines.some((l) => l.split(/\s+/)[0] === domain)) {
    lines.push(`${domain} OK`);
  }
  if (!dryRun) {
    await writeLines(POSTFIX_DOMAINS, lines);
    await postmap(POSTFIX_DOMAINS);
  }
}

async function ensureMailboxMap(email: string, dryRun: boolean) {
  const rel = mailboxRelPath(email);
  const lines = await readLines(POSTFIX_MAILBOXES);
  const next = lines.filter((l) => !l.toLowerCase().startsWith(`${email.toLowerCase()} `));
  next.push(`${email} ${rel}`);
  if (!dryRun) {
    await writeLines(POSTFIX_MAILBOXES, next);
    await postmap(POSTFIX_MAILBOXES);
  }
}

async function removeMailboxMap(email: string, dryRun: boolean) {
  const lines = await readLines(POSTFIX_MAILBOXES);
  const next = lines.filter((l) => !l.toLowerCase().startsWith(`${email.toLowerCase()} `));
  if (!dryRun) {
    await writeLines(POSTFIX_MAILBOXES, next);
    await postmap(POSTFIX_MAILBOXES);
  }
}

async function ensureMaildir(email: string, dryRun: boolean) {
  const home = mailboxAbsPath(email);
  if (dryRun) {
    console.log(`[DRY RUN] maildir ${home}`);
    return home;
  }
  await fs.mkdir(path.join(home, "cur"), { recursive: true });
  await fs.mkdir(path.join(home, "new"), { recursive: true });
  await fs.mkdir(path.join(home, "tmp"), { recursive: true });
  await exec("chown", ["-R", `${VMAIL_UID}:${VMAIL_GID}`, home]);
  await exec("chmod", ["-R", "700", home]);
  return home;
}

export async function createMailAccount(
  email: string,
  password: string,
  dryRun: boolean
) {
  const { domain } = splitEmail(email);
  const hash = dryRun ? "{SHA512-CRYPT}dry-run" : await hashPassword(password);
  await ensureDomain(domain, dryRun);
  await ensureMailboxMap(email, dryRun);
  await ensureMaildir(email, dryRun);
  await upsertDovecotUser(email, hash, dryRun);
  if (!dryRun) await reloadMail();
  return { email, home: mailboxAbsPath(email) };
}

export async function deleteMailAccount(
  email: string,
  dryRun: boolean,
  deleteFiles = false
) {
  await removeMailboxMap(email, dryRun);
  await removeDovecotUser(email, dryRun);
  if (deleteFiles && !dryRun) {
    await fs.rm(mailboxAbsPath(email), { recursive: true, force: true });
  }
  if (!dryRun) await reloadMail();
  return { email };
}

export async function resetMailPassword(
  email: string,
  password: string,
  dryRun: boolean
) {
  const hash = dryRun ? "{SHA512-CRYPT}dry-run" : await hashPassword(password);
  await ensureDomain(splitEmail(email).domain, dryRun);
  await ensureMailboxMap(email, dryRun);
  await ensureMaildir(email, dryRun);
  await upsertDovecotUser(email, hash, dryRun);
  if (!dryRun) await reloadMail();
  return { email };
}

export async function setMailAccountActive(
  email: string,
  isActive: boolean,
  dryRun: boolean
) {
  const lines = await readLines(DOVECOT_USERS);
  const idx = lines.findIndex((l) =>
    l.toLowerCase().startsWith(`${email.toLowerCase()}:`)
  );
  if (idx < 0) {
    throw new Error(`Mailbox not found: ${email}`);
  }
  const parts = lines[idx]!.split(":");
  // passwd-file: user:password:uid:gid:...
  // Disable by prefixing password with '!'
  let password = parts[1] ?? "*";
  if (!isActive) {
    if (!password.startsWith("!")) password = `!${password}`;
  } else if (password.startsWith("!")) {
    password = password.slice(1);
  }
  parts[1] = password;
  lines[idx] = parts.join(":");
  if (!dryRun) {
    await writeLines(DOVECOT_USERS, lines);
    await reloadMail();
  }
  return { email, isActive };
}

/** Ensure domain maps exist for an email without setting a usable password. */
export async function provisionMailboxShell(email: string, dryRun: boolean) {
  const { domain } = splitEmail(email);
  await ensureDomain(domain, dryRun);
  await ensureMailboxMap(email, dryRun);
  await ensureMaildir(email, dryRun);
  await upsertDovecotUser(email, "*", dryRun);
  if (!dryRun) await reloadMail();
  return { email, home: mailboxAbsPath(email), locked: true };
}
