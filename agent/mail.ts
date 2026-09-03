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
const POSTFIX_ALIASES = "/etc/postfix/virtual_alias_maps";
const DOVECOT_USERS = "/etc/dovecot/users";
const OPENDKIM_KEYS = "/etc/opendkim/keys";
const OPENDKIM_KEYTABLE = "/etc/opendkim/KeyTable";
const OPENDKIM_SIGNINGTABLE = "/etc/opendkim/SigningTable";
const OPENDKIM_TRUSTED = "/etc/opendkim/TrustedHosts";
const OPENDKIM_CONF = "/etc/opendkim.conf";

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
  dryRun: boolean,
  quotaMb?: number
) {
  const { domain, local } = splitEmail(email);
  const home = `/var/mail/vhosts/${domain}/${local}`;
  const quota =
    quotaMb && quotaMb > 0
      ? `userdb_quota_rule=*:storage=${Math.floor(quotaMb)}M`
      : "";
  const line = `${email}:${passwordHash}:${VMAIL_UID}:${VMAIL_GID}::${home}::${quota}`;
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
  dryRun: boolean,
  quotaMb?: number
) {
  const { domain } = splitEmail(email);
  const hash = dryRun ? "{SHA512-CRYPT}dry-run" : await hashPassword(password);
  await ensureDomain(domain, dryRun);
  await ensureMailboxMap(email, dryRun);
  await ensureMaildir(email, dryRun);
  await upsertDovecotUser(email, hash, dryRun, quotaMb);
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
  dryRun: boolean,
  quotaMb?: number
) {
  const hash = dryRun ? "{SHA512-CRYPT}dry-run" : await hashPassword(password);
  await ensureDomain(splitEmail(email).domain, dryRun);
  await ensureMailboxMap(email, dryRun);
  await ensureMaildir(email, dryRun);
  // Preserve existing quota from passwd line when not provided
  let quota = quotaMb;
  if (quota == null) {
    const lines = await readLines(DOVECOT_USERS);
    const existing = lines.find((l) =>
      l.toLowerCase().startsWith(`${email.toLowerCase()}:`)
    );
    const m = existing?.match(/storage=(\d+)M/i);
    if (m) quota = Number(m[1]);
  }
  await upsertDovecotUser(email, hash, dryRun, quota);
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

/** Point Postfix + Dovecot at a Let's Encrypt cert (IMAP/SMTP TLS). */
export async function applyMailDaemonTls(
  hostname: string
): Promise<{ applied: boolean; hostname: string }> {
  const safe = hostname.trim().toLowerCase();
  const cert = `/etc/letsencrypt/live/${safe}/fullchain.pem`;
  const key = `/etc/letsencrypt/live/${safe}/privkey.pem`;
  try {
    await fs.access(cert);
    await fs.access(key);
  } catch {
    return { applied: false, hostname: safe };
  }

  try {
    await exec("postconf", ["-e", `smtpd_tls_cert_file=${cert}`]);
    await exec("postconf", ["-e", `smtpd_tls_key_file=${key}`]);
    await exec("postfix", ["reload"]);
  } catch (error) {
    console.error("postfix TLS apply skipped:", error);
  }

  try {
    await fs.mkdir("/etc/dovecot/conf.d", { recursive: true });
    await fs.writeFile(
      "/etc/dovecot/conf.d/10-ssl.conf",
      `ssl = required
ssl_cert = <${cert}
ssl_key = <${key}
ssl_min_protocol = TLSv1.2
`,
      "utf8"
    );
    await exec("systemctl", ["reload", "dovecot"]);
  } catch (error) {
    console.error("dovecot TLS apply skipped:", error);
  }

  return { applied: true, hostname: safe };
}

async function ensurePostfixAliasMapsConfigured(dryRun: boolean) {
  if (dryRun) return;
  try {
    await fs.access(POSTFIX_ALIASES);
  } catch {
    await fs.writeFile(POSTFIX_ALIASES, "", "utf8");
  }
  await exec("postconf", [
    "-e",
    `virtual_alias_maps=hash:${POSTFIX_ALIASES}`,
  ]);
}

/** Upsert Postfix virtual alias (alias → forwardTo). Catch-all uses @domain. */
export async function createMailAlias(
  alias: string,
  forwardTo: string,
  dryRun: boolean
) {
  const aliasNorm = alias.trim().toLowerCase();
  const destNorm = forwardTo.trim().toLowerCase();
  if (!aliasNorm || !destNorm) {
    throw new Error("alias and forwardTo are required");
  }
  if (aliasNorm.startsWith("@")) {
    // catch-all: @domain
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(aliasNorm.slice(1))) {
      throw new Error("Invalid catch-all domain");
    }
  } else {
    splitEmail(aliasNorm);
  }
  splitEmail(destNorm);

  await ensurePostfixAliasMapsConfigured(dryRun);
  const lines = await readLines(POSTFIX_ALIASES);
  const key = aliasNorm;
  const next = lines.filter((l) => {
    const left = l.split(/\s+/)[0]?.toLowerCase();
    return left !== key;
  });
  next.push(`${key} ${destNorm}`);
  if (!dryRun) {
    await writeLines(POSTFIX_ALIASES, next);
    await postmap(POSTFIX_ALIASES);
    await exec("postfix", ["reload"]);
  }
  return { alias: key, forwardTo: destNorm };
}

export async function deleteMailAlias(alias: string, dryRun: boolean) {
  const key = alias.trim().toLowerCase();
  await ensurePostfixAliasMapsConfigured(dryRun);
  const lines = await readLines(POSTFIX_ALIASES);
  const next = lines.filter((l) => l.split(/\s+/)[0]?.toLowerCase() !== key);
  if (!dryRun) {
    await writeLines(POSTFIX_ALIASES, next);
    await postmap(POSTFIX_ALIASES);
    await exec("postfix", ["reload"]);
  }
  return { alias: key };
}

export async function setMailAccountQuota(
  email: string,
  quotaMb: number,
  dryRun: boolean
) {
  const lines = await readLines(DOVECOT_USERS);
  const idx = lines.findIndex((l) =>
    l.toLowerCase().startsWith(`${email.toLowerCase()}:`)
  );
  if (idx < 0) throw new Error(`Mailbox not found: ${email}`);
  const parts = lines[idx]!.split(":");
  while (parts.length < 7) parts.push("");
  parts[6] =
    quotaMb > 0
      ? `userdb_quota_rule=*:storage=${Math.floor(quotaMb)}M`
      : "";
  lines[idx] = parts.join(":");
  if (!dryRun) {
    await writeLines(DOVECOT_USERS, lines);
    await ensureDovecotQuotaPlugin(false);
    await exec("systemctl", ["reload", "dovecot"]);
  }
  return { email, quotaMb };
}

async function ensureDovecotQuotaPlugin(dryRun: boolean) {
  if (dryRun) return;
  const confPath = "/etc/dovecot/conf.d/90-quota.conf";
  const body = `mail_plugins = $mail_plugins quota
protocol imap {
  mail_plugins = $mail_plugins imap_quota
}
plugin {
  quota = maildir:User quota
  quota_rule = *:storage=1G
  quota_status_success = DUNNO
  quota_status_overquota = "552 5.2.2 Mailbox is full"
}
`;
  await fs.mkdir("/etc/dovecot/conf.d", { recursive: true });
  await fs.writeFile(confPath, body, "utf8");
}

export async function mailboxUsageBytes(
  email: string
): Promise<{ email: string; usedBytes: number; path: string }> {
  const home = mailboxAbsPath(email);
  try {
    const { stdout } = await exec("du", ["-sb", home]);
    const usedBytes = Number(stdout.trim().split(/\s+/)[0] || 0);
    return { email, usedBytes, path: home };
  } catch {
    return { email, usedBytes: 0, path: home };
  }
}

function dkimSelectorDefault() {
  return "naviyra";
}

export async function ensureDomainDkim(
  domain: string,
  dryRun: boolean,
  selector = dkimSelectorDefault()
): Promise<{
  domain: string;
  selector: string;
  publicKey: string;
  dnsName: string;
  dnsValue: string;
}> {
  const safeDomain = domain.trim().toLowerCase();
  const sel = selector.trim().toLowerCase() || dkimSelectorDefault();
  const keyDir = path.join(OPENDKIM_KEYS, safeDomain);
  const privateKey = path.join(keyDir, `${sel}.private`);
  const txtFile = path.join(keyDir, `${sel}.txt`);

  if (dryRun) {
    return {
      domain: safeDomain,
      selector: sel,
      publicKey: "DRYRUN",
      dnsName: `${sel}._domainkey`,
      dnsValue: `v=DKIM1; k=rsa; p=DRYRUN`,
    };
  }

  await fs.mkdir(keyDir, { recursive: true });
  try {
    await fs.access(privateKey);
  } catch {
    await exec("opendkim-genkey", [
      "-b",
      "2048",
      "-s",
      sel,
      "-d",
      safeDomain,
      "-D",
      keyDir,
    ]);
    await exec("chown", ["-R", "opendkim:opendkim", keyDir]);
    await exec("chmod", ["600", privateKey]);
  }

  let publicKey = "";
  try {
    const txt = await fs.readFile(txtFile, "utf8");
    const m = txt.match(/p=([A-Za-z0-9+/=]+)/);
    publicKey = m?.[1] ?? "";
  } catch {
    /* ignore */
  }
  if (!publicKey) {
    // Fallback: extract from private via openssl
    try {
      const { stdout } = await exec("openssl", [
        "rsa",
        "-in",
        privateKey,
        "-pubout",
        "-outform",
        "PEM",
      ]);
      publicKey = stdout
        .split("\n")
        .filter((l) => !l.includes("BEGIN") && !l.includes("END"))
        .join("")
        .replace(/\s+/g, "");
    } catch {
      throw new Error("Failed to read DKIM public key");
    }
  }

  await ensureOpenDkimTables(safeDomain, sel, privateKey, false);

  const dnsValue = `v=DKIM1; k=rsa; p=${publicKey}`;
  return {
    domain: safeDomain,
    selector: sel,
    publicKey,
    dnsName: `${sel}._domainkey`,
    dnsValue,
  };
}

async function ensureOpenDkimTables(
  domain: string,
  selector: string,
  privateKeyPath: string,
  dryRun: boolean
) {
  if (dryRun) return;
  await fs.mkdir(OPENDKIM_KEYS, { recursive: true });

  const keyId = `${selector}._domainkey.${domain}`;
  const keyLine = `${keyId} ${domain}:${selector}:${privateKeyPath}`;
  const signLine = `*@${domain} ${keyId}`;

  for (const [file, line, match] of [
    [OPENDKIM_KEYTABLE, keyLine, keyId] as const,
    [OPENDKIM_SIGNINGTABLE, signLine, `*@${domain}`] as const,
  ]) {
    const lines = await readLines(file);
    const next = lines.filter((l) => !l.includes(match));
    next.push(line);
    await writeLines(file, next);
  }

  const trusted = await readLines(OPENDKIM_TRUSTED);
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    if (!trusted.includes(host)) trusted.push(host);
  }
  await writeLines(OPENDKIM_TRUSTED, trusted);

  const conf = `Syslog                  yes
SyslogSuccess           yes
LogWhy                  yes
Canonicalization        relaxed/simple
Mode                    sv
SubDomains              yes
AutoRestart             yes
AutoRestartRate         10/1M
Background              yes
DNSTimeout              5
SignatureAlgorithm      rsa-sha256
KeyTable                refile:${OPENDKIM_KEYTABLE}
SigningTable            refile:${OPENDKIM_SIGNINGTABLE}
ExternalIgnoreList      refile:${OPENDKIM_TRUSTED}
InternalHosts           refile:${OPENDKIM_TRUSTED}
Socket                  inet:8891@localhost
PidFile                 /run/opendkim/opendkim.pid
UserID                  opendkim:opendkim
UMask                   007
`;
  await fs.writeFile(OPENDKIM_CONF, conf, "utf8");

  try {
    await exec("postconf", ["-e", "milter_default_action=accept"]);
    await exec("postconf", ["-e", "milter_protocol=6"]);
    await exec("postconf", [
      "-e",
      "smtpd_milters=inet:localhost:8891",
    ]);
    await exec("postconf", [
      "-e",
      "non_smtpd_milters=inet:localhost:8891",
    ]);
  } catch (error) {
    console.error("postfix milter config:", error);
  }

  try {
    await exec("systemctl", ["enable", "--now", "opendkim"]);
    await exec("systemctl", ["reload", "opendkim"]);
  } catch {
    try {
      await exec("systemctl", ["restart", "opendkim"]);
    } catch (error) {
      console.error("opendkim start:", error);
    }
  }
  try {
    await exec("postfix", ["reload"]);
  } catch {
    /* ignore */
  }
}

export async function installOpenDkim(dryRun: boolean) {
  if (dryRun) return { installed: true, dryRun: true };
  const { installPackages } = await import("./pkg-install");
  await installPackages({
    dryRun: false,
    name: "opendkim",
    packageSets: [["opendkim", "opendkim-tools"]],
  });
  await fs.mkdir(OPENDKIM_KEYS, { recursive: true });
  await fs.writeFile(OPENDKIM_KEYTABLE, "", { flag: "a" });
  await fs.writeFile(OPENDKIM_SIGNINGTABLE, "", { flag: "a" });
  await fs.writeFile(OPENDKIM_TRUSTED, "127.0.0.1\nlocalhost\n::1\n", {
    flag: "a",
  });
  return { installed: true };
}

export async function listMailQueue(dryRun: boolean) {
  if (dryRun) return { items: [] as Array<Record<string, string>> };
  try {
    const { stdout } = await exec("mailq", []);
    const items: Array<{
      id: string;
      size: string;
      arrival: string;
      sender: string;
      recipients: string;
      status: string;
    }> = [];
    // Simple parse: queue id lines start with alphanumeric id
    const blocks = stdout.split(/\n(?=[A-F0-9]+[\s*!])/i);
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (!lines[0]) continue;
      const head = lines[0].match(
        /^([A-Za-z0-9]+)\s+(\S+)\s+(.+?)\s+(\S+@\S+|MAILER-DAEMON)/
      );
      if (!head) continue;
      const recipients = lines
        .slice(1)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(", ");
      items.push({
        id: head[1]!,
        size: head[2]!,
        arrival: head[3]!,
        sender: head[4]!,
        recipients,
        status: lines[0]!.includes("*")
          ? "active"
          : lines[0]!.includes("!")
            ? "hold"
            : "deferred",
      });
    }
    if (items.length === 0 && /Mail queue is empty/i.test(stdout)) {
      return { items: [], raw: stdout };
    }
    return { items, raw: stdout };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function flushMailQueue(dryRun: boolean, id?: string) {
  if (dryRun) return { ok: true };
  if (id) {
    await exec("postqueue", ["-i", id]);
  } else {
    await exec("postqueue", ["-f"]);
  }
  return { ok: true, id: id ?? null };
}

export async function deleteMailQueueItem(id: string, dryRun: boolean) {
  if (dryRun) return { ok: true, id };
  await exec("postsuper", ["-d", id]);
  return { ok: true, id };
}

export async function tailMailLog(lines = 100, dryRun: boolean) {
  if (dryRun) return { lines: [] as string[] };
  const n = Math.min(Math.max(lines, 1), 500);
  const candidates = [
    "/var/log/mail.log",
    "/var/log/maillog",
    "/var/log/syslog",
  ];
  for (const file of candidates) {
    try {
      await fs.access(file);
      const { stdout } = await exec("tail", ["-n", String(n), file]);
      return {
        file,
        lines: stdout.split(/\r?\n/).filter(Boolean),
      };
    } catch {
      /* try next */
    }
  }
  return { file: null, lines: [] as string[] };
}

export async function installRspamd(dryRun: boolean) {
  if (dryRun) return { installed: true, dryRun: true };
  const { installPackages } = await import("./pkg-install");
  await installPackages({
    dryRun: false,
    name: "rspamd",
    packageSets: [["rspamd", "redis-server"]],
  });

  // Postfix milter for rspamd (port 11332)
  try {
    const { stdout } = await exec("postconf", ["-h", "smtpd_milters"]);
    const current = (stdout || "").trim();
    const rspamd = "inet:localhost:11332";
    const parts = current
      ? current.split(/,\s*/).filter(Boolean)
      : [];
    if (!parts.includes(rspamd)) parts.push(rspamd);
    // Keep OpenDKIM if present
    await exec("postconf", ["-e", `smtpd_milters=${parts.join(", ")}`]);
    await exec("postconf", ["-e", `non_smtpd_milters=${parts.join(", ")}`]);
    await exec("postconf", ["-e", "milter_default_action=accept"]);
  } catch (error) {
    console.error("rspamd milter config:", error);
  }

  // Enable Redis backend lightly
  const localConf = `/etc/rspamd/local.d/worker-proxy.inc`;
  try {
    await fs.mkdir("/etc/rspamd/local.d", { recursive: true });
    await fs.writeFile(
      localConf,
      `bind_socket = "localhost:11332";
milter = yes;
timeout = 120s;
upstream "local" {
  default = yes;
  self_scan = yes;
}
`,
      "utf8"
    );
  } catch (error) {
    console.error("rspamd local conf:", error);
  }

  try {
    await exec("systemctl", ["enable", "--now", "redis-server"]);
  } catch {
    try {
      await exec("systemctl", ["enable", "--now", "redis"]);
    } catch {
      /* optional */
    }
  }
  try {
    await exec("systemctl", ["enable", "--now", "rspamd"]);
    await exec("systemctl", ["restart", "rspamd"]);
    await exec("postfix", ["reload"]);
  } catch (error) {
    console.error("rspamd start:", error);
  }

  return { installed: true };
}

export async function installClamAv(dryRun: boolean) {
  if (dryRun) return { installed: true, dryRun: true };
  const { installPackages } = await import("./pkg-install");
  await installPackages({
    dryRun: false,
    name: "clamav",
    packageSets: [["clamav", "clamav-daemon", "clamav-freshclam"]],
  });
  try {
    await exec("systemctl", ["enable", "--now", "clamav-freshclam"]);
    await exec("systemctl", ["enable", "--now", "clamav-daemon"]);
  } catch (error) {
    console.error("clamav start:", error);
  }
  // Rspamd antivirus module hint
  try {
    await fs.mkdir("/etc/rspamd/local.d", { recursive: true });
    await fs.writeFile(
      "/etc/rspamd/local.d/antivirus.conf",
      `clamav {
  attachments_only = false;
  symbol = "CLAM_VIRUS";
  type = "clamav";
  servers = "/var/run/clamav/clamd.ctl";
}
`,
      "utf8"
    );
    await exec("systemctl", ["reload", "rspamd"]);
  } catch (error) {
    console.error("rspamd antivirus conf:", error);
  }
  return { installed: true };
}
