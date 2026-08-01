/**
 * Local FTP users via vsftpd (Linux).
 * Each panel FTP account maps to a system user with nologin shell,
 * chrooted to the site document root.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CONFIG_ROOT } from "./paths";

const exec = promisify(execFile);

const FTP_GROUP = "naviyra-ftp";
const USER_LIST = "/etc/vsftpd.user_list";
const VSFTPD_CONF = "/etc/vsftpd.conf";
const PASV_MIN = 40000;
const PASV_MAX = 40100;

const RESERVED = new Set([
  "root",
  "daemon",
  "bin",
  "sys",
  "sync",
  "games",
  "proxy",
  "www-data",
  "nobody",
  "nginx",
  "mysql",
  "postgres",
  "postfix",
  "dovecot",
  "named",
  "bind",
  "sshd",
  "ubuntu",
  "admin",
  "ftp",
  "anonymous",
  "naviyra",
]);

export function validateFtpUsername(username: string): string {
  const name = username.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_-]{2,31}$/.test(name)) {
    throw new Error(
      "FTP username must be 3–32 chars: start with a letter/underscore, then letters, digits, _ or -"
    );
  }
  if (RESERVED.has(name)) {
    throw new Error(`Username '${name}' is reserved`);
  }
  return name;
}

async function run(cmd: string, args: string[], dryRun: boolean) {
  if (dryRun) return;
  await exec(cmd, args);
}

async function userExists(username: string): Promise<boolean> {
  try {
    await exec("id", ["-u", username]);
    return true;
  } catch {
    return false;
  }
}

async function ensureNologinInShells(dryRun: boolean) {
  if (dryRun) return;
  const shellsFile = "/etc/shells";
  const candidates = ["/usr/sbin/nologin", "/sbin/nologin", "/bin/false"];
  let raw = "";
  try {
    raw = await fs.readFile(shellsFile, "utf8");
  } catch {
    raw = "";
  }
  const lines = raw.split(/\r?\n/);
  let changed = false;
  for (const shell of candidates) {
    if (fsSync.existsSync(shell) && !lines.some((l) => l.trim() === shell)) {
      lines.push(shell);
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(shellsFile, `${lines.filter(Boolean).join("\n")}\n`, "utf8");
  }
}

async function ensureGroup(dryRun: boolean) {
  try {
    await exec("getent", ["group", FTP_GROUP]);
  } catch {
    await run("groupadd", ["--system", FTP_GROUP], dryRun);
  }
}

async function readUserList(): Promise<string[]> {
  try {
    const raw = await fs.readFile(USER_LIST, "utf8");
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

async function writeUserList(users: string[], dryRun: boolean) {
  if (dryRun) return;
  const unique = Array.from(new Set(users.map((u) => u.toLowerCase()))).sort();
  await fs.writeFile(USER_LIST, `${unique.join("\n")}\n`, "utf8");
}

async function addToUserList(username: string, dryRun: boolean) {
  const users = await readUserList();
  if (!users.includes(username)) {
    users.push(username);
    await writeUserList(users, dryRun);
  }
}

async function removeFromUserList(username: string, dryRun: boolean) {
  const users = (await readUserList()).filter((u) => u !== username);
  await writeUserList(users, dryRun);
}

async function setPasswordPipe(
  username: string,
  password: string,
  dryRun: boolean
) {
  if (dryRun) return;
  await exec("bash", [
    "-c",
    `printf '%s:%s\\n' "$1" "$2" | chpasswd`,
    "chpasswd",
    username,
    password,
  ]);
}

async function appendFtpMap(
  username: string,
  homeDir: string,
  action: "create" | "delete"
) {
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.appendFile(
    path.join(CONFIG_ROOT, "ftp.map"),
    `${action} ${username}:${homeDir}\n`,
    "utf8"
  );
}

function pasvAddress(): string {
  return (
    process.env.SERVER_PUBLIC_IP?.trim() ||
    process.env.FTP_PASV_ADDRESS?.trim() ||
    ""
  );
}

export async function ensureVsftpdConfig(dryRun: boolean) {
  if (dryRun || process.platform === "win32") return;

  const ip = pasvAddress();
  const lines = [
    "listen=YES",
    "listen_ipv6=NO",
    "anonymous_enable=NO",
    "local_enable=YES",
    "write_enable=YES",
    "local_umask=022",
    "dirmessage_enable=YES",
    "use_localtime=YES",
    "xferlog_enable=YES",
    "connect_from_port_20=YES",
    "chroot_local_user=YES",
    "allow_writeable_chroot=YES",
    "secure_chroot_dir=/var/run/vsftpd/empty",
    "pam_service_name=vsftpd",
    "userlist_enable=YES",
    `userlist_file=${USER_LIST}`,
    "userlist_deny=NO",
    "pasv_enable=YES",
    `pasv_min_port=${PASV_MIN}`,
    `pasv_max_port=${PASV_MAX}`,
    ...(ip ? [`pasv_address=${ip}`] : []),
    "ssl_enable=NO",
  ];

  if (!fsSync.existsSync(VSFTPD_CONF) && !dryRun) {
    throw new Error("vsftpd is not installed — run scripts/install-ftp.sh");
  }

  if (!dryRun) {
    await fs.mkdir("/var/run/vsftpd/empty", { recursive: true });
    // Keep a backup once, then write our managed config
    if (fsSync.existsSync(VSFTPD_CONF) && !fsSync.existsSync(`${VSFTPD_CONF}.naviyra.bak`)) {
      await fs.copyFile(VSFTPD_CONF, `${VSFTPD_CONF}.naviyra.bak`);
    }
    await fs.writeFile(VSFTPD_CONF, `${lines.join("\n")}\n`, "utf8");
    if (!fsSync.existsSync(USER_LIST)) {
      await fs.writeFile(USER_LIST, "", "utf8");
    }
    await exec("systemctl", ["enable", "--now", "vsftpd"]).catch(async () => {
      await exec("systemctl", ["restart", "vsftpd"]);
    });
  }
}

export async function createFtpAccountOnServer(input: {
  username: string;
  password: string;
  homeDir: string;
  dryRun: boolean;
}) {
  const username = validateFtpUsername(input.username);
  const homeDir = path.resolve(input.homeDir);
  if (!homeDir.startsWith("/var/www/")) {
    throw new Error("FTP home must be under /var/www/");
  }
  if (!input.password || input.password.length < 8) {
    throw new Error("FTP password must be at least 8 characters");
  }

  await appendFtpMap(username, homeDir, "create");

  if (process.platform === "win32" || input.dryRun) {
    return { username, homeDir, dryRun: true };
  }

  await ensureGroup(false);
  await ensureNologinInShells(false);
  await ensureVsftpdConfig(false);
  await fs.mkdir(homeDir, { recursive: true });

  const exists = await userExists(username);
  if (exists) {
    await run("usermod", ["-d", homeDir, "-s", "/usr/sbin/nologin", "-g", FTP_GROUP, username], false);
  } else {
    await run(
      "useradd",
      [
        "--system",
        "--no-create-home",
        "--home-dir",
        homeDir,
        "--shell",
        "/usr/sbin/nologin",
        "--gid",
        FTP_GROUP,
        username,
      ],
      false
    );
  }

  await setPasswordPipe(username, input.password, false);
  // Site files owned by FTP user so uploads work; nginx can still read (755/644)
  await run("chown", ["-R", `${username}:${FTP_GROUP}`, homeDir], false);
  await run("chmod", ["755", homeDir], false);
  await addToUserList(username, false);
  await exec("systemctl", ["reload", "vsftpd"]).catch(async () => {
    await exec("systemctl", ["restart", "vsftpd"]);
  });

  return { username, homeDir, dryRun: false };
}

export async function deleteFtpAccountOnServer(input: {
  username: string;
  dryRun: boolean;
}) {
  const username = validateFtpUsername(input.username);
  await appendFtpMap(username, "-", "delete");

  if (process.platform === "win32" || input.dryRun) {
    return { username, dryRun: true };
  }

  await removeFromUserList(username, false);
  if (await userExists(username)) {
    // Keep website files — only remove the login user
    await run("userdel", [username], false);
  }
  await exec("systemctl", ["reload", "vsftpd"]).catch(() => undefined);

  return { username, dryRun: false };
}
