/**
 * Create / prune panel backups (tar.gz) and manage systemd timer units.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROJECT_ROOT, SITES_ROOT, DNS_ROOT } from "./paths";

const exec = promisify(execFile);
const isWindows = process.platform === "win32";

export type BackupSchedulePreset =
  | "EVERY_6H"
  | "DAILY_02"
  | "DAILY_03"
  | "WEEKLY_SUN";

export type RunBackupOptions = {
  backupRoot: string;
  retainCount: number;
  includePanelDb: boolean;
  includeSites: boolean;
  includeDns: boolean;
  includeMail: boolean;
  dryRun?: boolean;
};

export type RunBackupResult = {
  archivePath: string;
  sizeBytes: number;
  included: string[];
  pruned: string[];
};

export type RestoreBackupOptions = {
  archivePath: string;
  allowedRoot?: string;
  restorePanelDb?: boolean;
  restoreSites?: boolean;
  restoreDns?: boolean;
  restoreMail?: boolean;
  dryRun?: boolean;
};

export type RestoreBackupResult = {
  restored: string[];
  safetyDbBackup?: string;
  panelRestartScheduled: boolean;
};

export type DeleteBackupOptions = {
  archivePath: string;
  allowedRoot?: string;
  dryRun?: boolean;
};

function assertArchiveUnderAllowedRoot(
  archivePath: string,
  allowedRoot?: string
): string {
  const resolved = path.resolve(archivePath);
  if (!resolved.endsWith(".tar.gz") && !resolved.endsWith(".tgz")) {
    throw new Error("Archive must be a .tar.gz backup file");
  }

  const allowedRoots = [
    path.resolve(
      allowedRoot || process.env.BACKUP_ROOT || "/var/backups/naviyra"
    ),
    path.resolve(path.join(PROJECT_ROOT, "data", "backups")),
    path.resolve("/var/backups/naviyra"),
  ];
  const underAllowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
  if (!underAllowed) {
    throw new Error(
      "Archive must be under the configured backup root (e.g. /var/backups/naviyra)"
    );
  }
  return resolved;
}

const ON_CALENDAR: Record<BackupSchedulePreset, string> = {
  EVERY_6H: "*-*-* 00/6:00:00",
  DAILY_02: "*-*-* 02:00:00",
  DAILY_03: "*-*-* 03:00:00",
  WEEKLY_SUN: "Sun *-*-* 03:00:00",
};

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function resolvePanelDbPath(): string | null {
  const url = process.env.DATABASE_URL?.trim() || "file:./data/naviyra.db";
  if (!url.startsWith("file:")) return null;
  let file = url.slice("file:".length);
  if (file.startsWith("./") || (!path.isAbsolute(file) && !file.match(/^[A-Za-z]:/))) {
    file = path.join(PROJECT_ROOT, file);
  }
  return file;
}

function mailVhostsDir(): string {
  return process.env.MAIL_VHOSTS_DIR?.trim() || "/var/mail/vhosts";
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function runBackup(
  options: RunBackupOptions
): Promise<RunBackupResult> {
  const backupRoot = options.backupRoot || "/var/backups/naviyra";
  await fs.mkdir(backupRoot, { recursive: true });

  const workDir = path.join(backupRoot, `.work-${stamp()}`);
  const included: string[] = [];
  const archiveName = `naviyra-backup-${stamp()}.tar.gz`;
  const archivePath = path.join(backupRoot, archiveName);

  if (options.dryRun) {
    return {
      archivePath,
      sizeBytes: 0,
      included: ["(dry-run)"],
      pruned: [],
    };
  }

  await fs.mkdir(workDir, { recursive: true });

  try {
    if (options.includePanelDb) {
      const dbPath = resolvePanelDbPath();
      if (dbPath && (await pathExists(dbPath))) {
        const dest = path.join(workDir, "panel-db");
        await fs.mkdir(dest, { recursive: true });
        await fs.copyFile(dbPath, path.join(dest, path.basename(dbPath)));
        // SQLite WAL companions if present
        for (const suffix of ["-wal", "-shm"]) {
          const side = `${dbPath}${suffix}`;
          if (await pathExists(side)) {
            await fs.copyFile(side, path.join(dest, path.basename(side)));
          }
        }
        included.push("panel-db");
      }
    }

    if (options.includeSites) {
      const sitesPath = isWindows ? SITES_ROOT : "/var/www";
      if (await pathExists(sitesPath)) {
        const dest = path.join(workDir, "sites");
        if (isWindows) {
          await fs.cp(sitesPath, dest, { recursive: true });
        } else {
          // Prefer hardlink tree when possible for speed; fall back to cp
          try {
            await exec("cp", ["-a", sitesPath, dest]);
          } catch {
            await fs.cp(sitesPath, dest, { recursive: true });
          }
        }
        included.push("sites");
      }
    }

    if (options.includeDns) {
      if (await pathExists(DNS_ROOT)) {
        await fs.cp(DNS_ROOT, path.join(workDir, "dns"), { recursive: true });
        included.push("dns");
      }
      const bindZones = process.env.BIND_ZONES_DIR?.trim();
      if (bindZones && (await pathExists(bindZones))) {
        await fs.cp(bindZones, path.join(workDir, "bind-zones"), {
          recursive: true,
        });
        included.push("bind-zones");
      }
    }

    if (options.includeMail && !isWindows) {
      const mailDir = mailVhostsDir();
      if (await pathExists(mailDir)) {
        try {
          await exec("cp", ["-a", mailDir, path.join(workDir, "mail")]);
          included.push("mail");
        } catch {
          /* skip if permission denied */
        }
      }
    }

    if (included.length === 0) {
      throw new Error("Nothing to back up — enable at least one include option");
    }

    if (isWindows) {
      // Best-effort zip via PowerShell when tar may be available too
      try {
        await exec("tar", ["-czf", archivePath, "-C", workDir, "."]);
      } catch {
        throw new Error("tar is required to create backups on this host");
      }
    } else {
      await exec("tar", ["-czf", archivePath, "-C", workDir, "."]);
    }

    const stat = await fs.stat(archivePath);
    const pruned = await pruneOldBackups(
      backupRoot,
      Math.max(1, options.retainCount || 7)
    );

    return {
      archivePath,
      sizeBytes: stat.size,
      included,
      pruned,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Restore from a naviyra-backup-*.tar.gz created by runBackup.
 * Overwrites selected targets. Creates a safety copy of the live panel DB first.
 */
export async function deleteBackup(
  options: DeleteBackupOptions
): Promise<{ deleted: string; missing: boolean }> {
  const archivePath = assertArchiveUnderAllowedRoot(
    options.archivePath,
    options.allowedRoot
  );

  if (options.dryRun) {
    return { deleted: archivePath, missing: false };
  }

  if (!(await pathExists(archivePath))) {
    return { deleted: archivePath, missing: true };
  }

  await fs.rm(archivePath, { force: true });
  return { deleted: archivePath, missing: false };
}

export async function restoreBackup(
  options: RestoreBackupOptions
): Promise<RestoreBackupResult> {
  const archivePath = assertArchiveUnderAllowedRoot(
    options.archivePath,
    options.allowedRoot
  );
  if (!(await pathExists(archivePath))) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  if (options.dryRun) {
    return { restored: ["(dry-run)"], panelRestartScheduled: false };
  }

  const extractDir = path.join(
    path.dirname(archivePath),
    `.restore-${stamp()}`
  );
  await fs.mkdir(extractDir, { recursive: true });
  const restored: string[] = [];
  let safetyDbBackup: string | undefined;
  let panelRestartScheduled = false;

  try {
    await exec("tar", ["-xzf", archivePath, "-C", extractDir]);

    const wantDb = options.restorePanelDb === true;
    const wantSites = options.restoreSites === true;
    const wantDns = options.restoreDns === true;
    const wantMail = options.restoreMail === true;

    if (wantSites && (await pathExists(path.join(extractDir, "sites")))) {
      const sitesDest = isWindows ? SITES_ROOT : "/var/www";
      await fs.mkdir(sitesDest, { recursive: true });
      if (isWindows) {
        await fs.cp(path.join(extractDir, "sites"), sitesDest, {
          recursive: true,
          force: true,
        });
      } else {
        await exec("cp", [
          "-a",
          `${path.join(extractDir, "sites")}/.`,
          sitesDest,
        ]);
      }
      restored.push("sites");
    }

    if (wantDns) {
      if (await pathExists(path.join(extractDir, "dns"))) {
        await fs.mkdir(DNS_ROOT, { recursive: true });
        if (isWindows) {
          await fs.cp(path.join(extractDir, "dns"), DNS_ROOT, {
            recursive: true,
            force: true,
          });
        } else {
          await exec("cp", [
            "-a",
            `${path.join(extractDir, "dns")}/.`,
            DNS_ROOT,
          ]);
        }
        restored.push("dns");
      }
      const bindZones = process.env.BIND_ZONES_DIR?.trim();
      if (
        bindZones &&
        (await pathExists(path.join(extractDir, "bind-zones")))
      ) {
        await fs.mkdir(bindZones, { recursive: true });
        await exec("cp", [
          "-a",
          `${path.join(extractDir, "bind-zones")}/.`,
          bindZones,
        ]);
        restored.push("bind-zones");
        try {
          await exec("rndc", ["reload"]);
        } catch {
          await exec("systemctl", ["reload", "named"]).catch(() => undefined);
        }
      }
    }

    if (
      wantMail &&
      !isWindows &&
      (await pathExists(path.join(extractDir, "mail")))
    ) {
      const mailDir = mailVhostsDir();
      await fs.mkdir(mailDir, { recursive: true });
      await exec("cp", ["-a", `${path.join(extractDir, "mail")}/.`, mailDir]);
      restored.push("mail");
    }

    if (wantDb && (await pathExists(path.join(extractDir, "panel-db")))) {
      const dbPath = resolvePanelDbPath();
      if (!dbPath) throw new Error("DATABASE_URL is not a file: SQLite path");

      await fs.mkdir(path.dirname(dbPath), { recursive: true });
      safetyDbBackup = `${dbPath}.pre-restore-${stamp()}`;
      if (await pathExists(dbPath)) {
        await fs.copyFile(dbPath, safetyDbBackup);
      }

      const dbName = path.basename(dbPath);
      const srcDb = path.join(extractDir, "panel-db", dbName);
      if (!(await pathExists(srcDb))) {
        // Fall back to any .db in panel-db/
        const files = await fs.readdir(path.join(extractDir, "panel-db"));
        const found = files.find((f) => f.endsWith(".db"));
        if (!found) throw new Error("No SQLite database found in archive");
        await fs.copyFile(
          path.join(extractDir, "panel-db", found),
          dbPath
        );
      } else {
        await fs.copyFile(srcDb, dbPath);
      }

      for (const suffix of ["-wal", "-shm"]) {
        const src = path.join(extractDir, "panel-db", `${dbName}${suffix}`);
        const dest = `${dbPath}${suffix}`;
        if (await pathExists(src)) {
          await fs.copyFile(src, dest);
        } else {
          await fs.rm(dest, { force: true });
        }
      }
      restored.push("panel-db");

      if (!isWindows) {
        // Restart panel after response can flush — detached
        const { spawn } = await import("node:child_process");
        spawn(
          "bash",
          ["-c", "sleep 2; systemctl restart naviyra-panel"],
          { detached: true, stdio: "ignore" }
        ).unref();
        panelRestartScheduled = true;
      }
    }

    if (restored.length === 0) {
      throw new Error(
        "Nothing restored — archive may be empty or selected parts missing"
      );
    }

    return { restored, safetyDbBackup, panelRestartScheduled };
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
}

async function pruneOldBackups(
  backupRoot: string,
  retainCount: number
): Promise<string[]> {
  const entries = await fs.readdir(backupRoot);
  const archives = entries
    .filter((name) => /^naviyra-backup-.*\.tar\.gz$/.test(name))
    .map((name) => {
      const full = path.join(backupRoot, name);
      const st = fsSync.statSync(full);
      return { name, full, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const pruned: string[] = [];
  for (const old of archives.slice(retainCount)) {
    await fs.rm(old.full, { force: true });
    pruned.push(old.name);
  }
  return pruned;
}

function safeDomainLabel(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^\.+|\.+$/g, "");
}

function assertSafeDomainName(domain: string): string {
  const d = domain.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) {
    throw new Error("Invalid domain name");
  }
  if (d.includes("..") || d.includes("/") || d.includes("\\")) {
    throw new Error("Invalid domain name");
  }
  return d;
}

function domainSitesPath(domain: string): string {
  return isWindows
    ? path.join(SITES_ROOT, domain)
    : path.join("/var/www", domain);
}

async function pruneDomainBackups(
  backupRoot: string,
  domain: string,
  retainCount: number
): Promise<string[]> {
  const label = safeDomainLabel(domain);
  const prefix = `naviyra-domain-${label}-`;
  const entries = await fs.readdir(backupRoot);
  const archives = entries
    .filter(
      (name) => name.startsWith(prefix) && name.endsWith(".tar.gz")
    )
    .map((name) => {
      const full = path.join(backupRoot, name);
      const st = fsSync.statSync(full);
      return { name, full, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const pruned: string[] = [];
  for (const old of archives.slice(Math.max(1, retainCount))) {
    await fs.rm(old.full, { force: true });
    pruned.push(old.name);
  }
  return pruned;
}

async function reloadBindBestEffort(): Promise<void> {
  try {
    await exec("rndc", ["reload"]);
  } catch {
    await exec("systemctl", ["reload", "named"]).catch(() => undefined);
  }
}

export type RunDomainBackupOptions = {
  domain: string;
  backupRoot: string;
  retainCount: number;
  includeSites: boolean;
  includeDns: boolean;
  includeMail: boolean;
  dryRun?: boolean;
};

export type RestoreDomainBackupOptions = {
  archivePath: string;
  allowedRoot?: string;
  domain?: string;
  restoreSites?: boolean;
  restoreDns?: boolean;
  restoreMail?: boolean;
  dryRun?: boolean;
};

/**
 * Backup a single domain: site tree + DNS zone + mail vhost.
 */
export async function runDomainBackup(
  options: RunDomainBackupOptions
): Promise<RunBackupResult> {
  const domain = assertSafeDomainName(options.domain);
  const backupRoot = options.backupRoot || "/var/backups/naviyra";
  await fs.mkdir(backupRoot, { recursive: true });

  const label = safeDomainLabel(domain);
  const workDir = path.join(backupRoot, `.work-domain-${label}-${stamp()}`);
  const included: string[] = [];
  const archiveName = `naviyra-domain-${label}-${stamp()}.tar.gz`;
  const archivePath = path.join(backupRoot, archiveName);

  if (options.dryRun) {
    return {
      archivePath,
      sizeBytes: 0,
      included: ["(dry-run)"],
      pruned: [],
    };
  }

  await fs.mkdir(workDir, { recursive: true });

  try {
    if (options.includeSites) {
      const sitesPath = domainSitesPath(domain);
      if (await pathExists(sitesPath)) {
        const dest = path.join(workDir, "sites", domain);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        if (isWindows) {
          await fs.cp(sitesPath, dest, { recursive: true });
        } else {
          try {
            await exec("cp", ["-a", sitesPath, dest]);
          } catch {
            await fs.cp(sitesPath, dest, { recursive: true });
          }
        }
        included.push("sites");
      }
    }

    if (options.includeDns) {
      const zoneFileName = `db.${domain}`;
      const namedBlockName = `${domain}.conf`;
      const zonesDir = path.join(DNS_ROOT, "zones");
      const namedDir = path.join(DNS_ROOT, "named");
      const zoneSrc = path.join(zonesDir, zoneFileName);
      const namedSrc = path.join(namedDir, namedBlockName);
      let copiedDns = false;

      if (await pathExists(zoneSrc)) {
        const destZones = path.join(workDir, "dns", "zones");
        await fs.mkdir(destZones, { recursive: true });
        await fs.copyFile(zoneSrc, path.join(destZones, zoneFileName));
        copiedDns = true;
      }
      if (await pathExists(namedSrc)) {
        const destNamed = path.join(workDir, "dns", "named");
        await fs.mkdir(destNamed, { recursive: true });
        await fs.copyFile(namedSrc, path.join(destNamed, namedBlockName));
        copiedDns = true;
      }

      const manifestPath = path.join(DNS_ROOT, "zones.json");
      if (await pathExists(manifestPath)) {
        try {
          const full = JSON.parse(
            await fs.readFile(manifestPath, "utf8")
          ) as Record<string, unknown>;
          if (full[domain]) {
            const filtered = { [domain]: full[domain] };
            await fs.mkdir(path.join(workDir, "dns"), { recursive: true });
            await fs.writeFile(
              path.join(workDir, "dns", "zones.json"),
              JSON.stringify(filtered, null, 2),
              "utf8"
            );
            copiedDns = true;
          }
        } catch {
          /* ignore bad manifest */
        }
      }

      const bindZones = process.env.BIND_ZONES_DIR?.trim();
      if (bindZones) {
        const bindSrc = path.join(bindZones, zoneFileName);
        if (await pathExists(bindSrc)) {
          const dest = path.join(workDir, "bind-zones");
          await fs.mkdir(dest, { recursive: true });
          await fs.copyFile(bindSrc, path.join(dest, zoneFileName));
          included.push("bind-zones");
          copiedDns = true;
        }
      }

      if (copiedDns) included.push("dns");
    }

    if (options.includeMail && !isWindows) {
      const mailSrc = path.join(mailVhostsDir(), domain);
      if (await pathExists(mailSrc)) {
        const dest = path.join(workDir, "mail", domain);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        try {
          await exec("cp", ["-a", mailSrc, dest]);
          included.push("mail");
        } catch {
          /* skip if permission denied */
        }
      }
    }

    if (included.length === 0) {
      throw new Error(
        `Nothing to back up for ${domain} — site/DNS/mail not found or disabled`
      );
    }

    await fs.writeFile(
      path.join(workDir, "manifest.json"),
      JSON.stringify(
        { type: "domain", domain, included, createdAt: new Date().toISOString() },
        null,
        2
      ),
      "utf8"
    );

    await exec("tar", ["-czf", archivePath, "-C", workDir, "."]);

    const stat = await fs.stat(archivePath);
    const pruned = await pruneDomainBackups(
      backupRoot,
      domain,
      Math.max(1, options.retainCount || 7)
    );

    return {
      archivePath,
      sizeBytes: stat.size,
      included,
      pruned,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Restore a single-domain archive created by runDomainBackup.
 */
export async function restoreDomainBackup(
  options: RestoreDomainBackupOptions
): Promise<RestoreBackupResult> {
  const archivePath = assertArchiveUnderAllowedRoot(
    options.archivePath,
    options.allowedRoot
  );
  if (!(await pathExists(archivePath))) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  if (options.dryRun) {
    return { restored: ["(dry-run)"], panelRestartScheduled: false };
  }

  const extractDir = path.join(
    path.dirname(archivePath),
    `.restore-domain-${stamp()}`
  );
  await fs.mkdir(extractDir, { recursive: true });
  const restored: string[] = [];

  try {
    await exec("tar", ["-xzf", archivePath, "-C", extractDir]);

    let domain =
      options.domain?.trim().toLowerCase() ||
      "";
    try {
      const manifestRaw = await fs.readFile(
        path.join(extractDir, "manifest.json"),
        "utf8"
      );
      const manifest = JSON.parse(manifestRaw) as {
        type?: string;
        domain?: string;
      };
      if (manifest.domain) domain = manifest.domain.trim().toLowerCase();
    } catch {
      /* fall through */
    }

    if (!domain) {
      // Infer from sites/<domain> or mail/<domain>
      const sitesRoot = path.join(extractDir, "sites");
      if (await pathExists(sitesRoot)) {
        const kids = await fs.readdir(sitesRoot);
        if (kids.length === 1) domain = kids[0]!;
      }
    }
    if (!domain) {
      throw new Error("Domain archive missing domain name (manifest.json)");
    }
    domain = assertSafeDomainName(domain);

    const wantSites = options.restoreSites === true;
    const wantDns = options.restoreDns === true;
    const wantMail = options.restoreMail === true;

    if (wantSites && (await pathExists(path.join(extractDir, "sites", domain)))) {
      const sitesDest = domainSitesPath(domain);
      await fs.mkdir(path.dirname(sitesDest), { recursive: true });
      if (isWindows) {
        await fs.cp(path.join(extractDir, "sites", domain), sitesDest, {
          recursive: true,
          force: true,
        });
      } else {
        await fs.mkdir(sitesDest, { recursive: true });
        await exec("cp", [
          "-a",
          `${path.join(extractDir, "sites", domain)}/.`,
          sitesDest,
        ]);
      }
      restored.push("sites");
    }

    if (wantDns) {
      const zoneFileName = `db.${domain}`;
      const namedBlockName = `${domain}.conf`;
      const zoneSrc = path.join(extractDir, "dns", "zones", zoneFileName);
      const namedSrc = path.join(extractDir, "dns", "named", namedBlockName);
      let didDns = false;

      if (await pathExists(zoneSrc)) {
        const zonesDir = path.join(DNS_ROOT, "zones");
        await fs.mkdir(zonesDir, { recursive: true });
        await fs.copyFile(zoneSrc, path.join(zonesDir, zoneFileName));
        didDns = true;
      }
      if (await pathExists(namedSrc)) {
        const namedDir = path.join(DNS_ROOT, "named");
        await fs.mkdir(namedDir, { recursive: true });
        await fs.copyFile(namedSrc, path.join(namedDir, namedBlockName));
        didDns = true;
      }

      const filteredManifest = path.join(extractDir, "dns", "zones.json");
      if (await pathExists(filteredManifest)) {
        const manifestPath = path.join(DNS_ROOT, "zones.json");
        let manifest: Record<string, unknown> = {};
        if (await pathExists(manifestPath)) {
          try {
            manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
          } catch {
            manifest = {};
          }
        }
        try {
          const patch = JSON.parse(
            await fs.readFile(filteredManifest, "utf8")
          ) as Record<string, unknown>;
          Object.assign(manifest, patch);
          await fs.mkdir(DNS_ROOT, { recursive: true });
          await fs.writeFile(
            manifestPath,
            JSON.stringify(manifest, null, 2),
            "utf8"
          );
          didDns = true;
        } catch {
          /* ignore */
        }
      }

      const bindZones = process.env.BIND_ZONES_DIR?.trim();
      const bindSrc = path.join(extractDir, "bind-zones", zoneFileName);
      if (bindZones && (await pathExists(bindSrc))) {
        await fs.mkdir(bindZones, { recursive: true });
        await fs.copyFile(bindSrc, path.join(bindZones, zoneFileName));
        restored.push("bind-zones");
        didDns = true;
        if (!isWindows) await reloadBindBestEffort();
      } else if (didDns && !isWindows) {
        await reloadBindBestEffort();
      }

      if (didDns) restored.push("dns");
    }

    if (
      wantMail &&
      !isWindows &&
      (await pathExists(path.join(extractDir, "mail", domain)))
    ) {
      const mailDir = path.join(mailVhostsDir(), domain);
      await fs.mkdir(path.dirname(mailDir), { recursive: true });
      await fs.mkdir(mailDir, { recursive: true });
      await exec("cp", [
        "-a",
        `${path.join(extractDir, "mail", domain)}/.`,
        mailDir,
      ]);
      restored.push("mail");
    }

    if (restored.length === 0) {
      throw new Error(
        "Nothing restored — archive may be empty or selected parts missing"
      );
    }

    return { restored, panelRestartScheduled: false };
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
}

export function onCalendarForSchedule(schedule: BackupSchedulePreset): string {
  return ON_CALENDAR[schedule] ?? ON_CALENDAR.DAILY_03;
}

export async function configureBackupTimer(options: {
  enabled: boolean;
  schedule: BackupSchedulePreset;
  panelPort: number;
  workerToken: string;
  dryRun?: boolean;
}): Promise<{ installed: boolean; onCalendar: string }> {
  if (isWindows) {
    return {
      installed: false,
      onCalendar: onCalendarForSchedule(options.schedule),
    };
  }

  const onCalendar = onCalendarForSchedule(options.schedule);
  const unitDir = "/etc/systemd/system";
  const servicePath = path.join(unitDir, "naviyra-backup.service");
  const timerPath = path.join(unitDir, "naviyra-backup.timer");
  const scriptPath = "/opt/naviyra-panel/scripts/backup-worker.sh";

  const service = `[Unit]
Description=Naviyra Panel Backup Worker
After=network.target naviyra-panel.service

[Service]
Type=oneshot
User=root
Environment=PANEL_PORT=${options.panelPort}
Environment=BACKUP_WORKER_TOKEN=${options.workerToken}
ExecStart=${scriptPath}
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
`;

  const timer = `[Unit]
Description=Naviyra Panel Backup Worker Timer

[Timer]
OnCalendar=${onCalendar}
Persistent=true
RandomizedDelaySec=5m

[Install]
WantedBy=timers.target
`;

  if (options.dryRun) {
    return { installed: false, onCalendar };
  }

  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  // Ensure worker script exists (install script also copies it)
  if (!(await pathExists(scriptPath))) {
    const localScript = path.join(PROJECT_ROOT, "scripts", "backup-worker.sh");
    if (await pathExists(localScript)) {
      await fs.copyFile(localScript, scriptPath);
      await fs.chmod(scriptPath, 0o755);
    }
  }

  await fs.writeFile(servicePath, service, "utf8");
  await fs.writeFile(timerPath, timer, "utf8");
  await exec("systemctl", ["daemon-reload"]);

  if (options.enabled) {
    await exec("systemctl", ["enable", "--now", "naviyra-backup.timer"]);
  } else {
    await exec("systemctl", ["disable", "--now", "naviyra-backup.timer"]).catch(
      () => undefined
    );
  }

  return { installed: true, onCalendar };
}
