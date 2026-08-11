/**
 * Naviyra Server Agent — cross-platform (Windows + Linux)
 */

import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  API_KEY,
  CONFIG_ROOT,
  DNS_ROOT,
  getAgentBindHost,
  getBindIncludeFile,
  getBindNamedDir,
  getBindReloadCmd,
  getBindZonesDir,
  PROJECT_ROOT,
  resolveDocumentRoot,
  resolveSslDocumentRoot,
  resolveSubdomainRoot,
  SITES_ROOT,
} from "./paths";
import {
  assertSafeDocumentRoot,
  sanitizeHostnameForPath,
} from "./hostname";
import { applyDnsZone, removeDnsZone, type SyncDnsZonePayload } from "./dns";
import {
  createMailAccount as createVirtualMailbox,
  deleteMailAccount as deleteVirtualMailbox,
  resetMailPassword as resetVirtualMailboxPassword,
  setMailAccountActive as setVirtualMailboxActive,
  provisionMailboxShell,
} from "./mail";
import {
  buildHttpVhost,
  buildHttpsVhost,
  buildMailProxyHttpVhost,
  buildMailProxyHttpsVhost,
  ensureDefaultIndex,
  expandSslHosts,
  isMailHostname,
  issueLetsEncrypt,
  readCertDates,
  removeNginxSite,
  resolveVhostOptions,
  writeAndEnableNginxSite,
} from "./nginx";
import { resolvePhpFpmPass } from "./php-fpm";
import { attachTerminalWs } from "./terminal";
import { bearerTokenMatches } from "./timing-safe";
import { assertValidIpAddress, sanitizeBlockReason } from "./ip";
import { extractZipArchive, isZipFileName } from "./zip";
import {
  allocateUpstreamPort,
  getAppUnitStatus,
  isProxyAppType,
  removeAppUnit,
  restartAppUnit,
  startAppUnit,
  stopAppUnit,
  writeAppUnit,
} from "./apps";
import {
  configureBackupTimer,
  deleteBackup,
  restoreBackup,
  restoreDomainBackup,
  runBackup,
  runDomainBackup,
  type BackupSchedulePreset,
} from "./backup";
import {
  createFtpAccountOnServer,
  deleteFtpAccountOnServer,
} from "./ftp";
import {
  createPostgresDatabaseOnServer,
  createPostgresTableOnServer,
  alterPostgresTableOnServer,
  deletePostgresDatabaseOnServer,
  deletePostgresTableOnServer,
  inspectPostgresSchemaOnServer,
  previewPostgresTableOnServer,
  resetPostgresPasswordOnServer,
} from "./postgres";
import type { VhostOptions } from "./nginx";
const exec = promisify(execFile);
const PORT = Number(process.env.AGENT_PORT ?? 4000);
const isWindows = process.platform === "win32";
const DRY_RUN =
  process.env.AGENT_DRY_RUN === "true" ||
  (process.env.AGENT_DRY_RUN !== "false" && isWindows);

function hasAdminPermission(): boolean {
  if (isWindows) return false;
  return typeof process.getuid === "function" && process.getuid() === 0;
}

type Action = {
  action: string;
  [key: string]: unknown;
};

function unauthorized(res: http.ServerResponse) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
}

async function writeUploadedFile(
  filePath: string,
  content: Buffer,
  removeZip: boolean
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  if (isZipFileName(filePath)) {
    const destDir = path.dirname(filePath);
    const result = await extractZipArchive(filePath, destDir, {
      removeZip,
    });
    return {
      success: true as const,
      data: {
        path: filePath,
        extracted: true,
        extractedTo: result.extractedTo,
        removedZip: result.removedZip,
      },
    };
  }
  return { success: true as const, data: { path: filePath } };
}

async function ensureConfigDir() {
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
}

async function runCmd(cmd: string, args: string[]): Promise<string> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] ${cmd} ${args.join(" ")}`);
    return "";
  }
  const { stdout } = await exec(cmd, args);
  return stdout;
}

async function writeVhostConfig(
  domain: string,
  documentRoot: string,
  phpEnabled = true,
  extras?: Partial<VhostOptions>
) {
  await ensureConfigDir();
  const safeDomain = sanitizeHostnameForPath(domain);
  const safeRoot = assertSafeDocumentRoot(documentRoot);
  const configPath = path.join(CONFIG_ROOT, `${safeDomain}.conf`);
  const appType = extras?.appType ?? (phpEnabled ? "PHP" : "STATIC");
  const content = `# Naviyra vhost\n# domain: ${safeDomain}\n# root: ${safeRoot}\n# appType: ${appType}\n# php: ${phpEnabled}\n`;
  await fs.writeFile(configPath, content, "utf8");

  if (!isWindows) {
    await ensureDefaultIndex(safeRoot, safeDomain);
    const vhostOpts = await resolveVhostOptions(phpEnabled, {
      appType,
      upstreamPort: extras?.upstreamPort ?? null,
      spaMode: extras?.spaMode,
    });
    const certDir = `/etc/letsencrypt/live/${safeDomain}`;
    const hasCert =
      fsSync.existsSync(path.join(certDir, "fullchain.pem")) &&
      fsSync.existsSync(path.join(certDir, "privkey.pem"));
    const hosts = expandSslHosts(safeDomain, ["www"]);
    const conf = hasCert
      ? buildHttpsVhost(hosts, safeRoot, certDir, vhostOpts)
      : buildHttpVhost(hosts, safeRoot, vhostOpts);
    await writeAndEnableNginxSite(safeDomain, conf, DRY_RUN);
  }
}

async function handleAction(payload: Action) {
  switch (payload.action) {
    case "ping":
      return {
        success: true,
        data: {
          version: "0.1.0",
          dryRun: DRY_RUN,
          platform: process.platform,
          isAdmin: hasAdminPermission(),
          sitesRoot: SITES_ROOT,
        },
      };

    case "runtime_versions": {
      const versions: { node: string | null; python: string | null; go: string | null } = {
        node: null,
        python: null,
        go: null,
      };
      try {
        const { stdout } = await exec("node", ["-v"]);
        versions.node = stdout.trim() || null;
      } catch {
        /* missing */
      }
      try {
        const { stdout } = await exec("python3", ["--version"]);
        versions.python = stdout.trim() || null;
      } catch {
        /* missing */
      }
      try {
        const { stdout } = await exec("go", ["version"]);
        versions.go = stdout.trim() || null;
      } catch {
        /* missing */
      }
      return { success: true, data: versions };
    }

    case "create_domain": {
      const domain = sanitizeHostnameForPath(String(payload.domain));
      const documentRoot = resolveDocumentRoot(
        String(payload.documentRoot ?? ""),
        domain
      );
      const appType = String(payload.appType ?? (payload.phpEnabled === false ? "STATIC" : "PHP"));
      const phpEnabled = appType === "PHP";
      const upstreamPort = payload.upstreamPort
        ? Number(payload.upstreamPort)
        : null;
      await fs.mkdir(documentRoot, { recursive: true });
      await writeVhostConfig(domain, documentRoot, phpEnabled, {
        appType,
        upstreamPort,
      });
      return {
        success: true,
        data: {
          domain,
          documentRoot,
          phpEnabled,
          appType,
          upstreamPort,
          phpFpm: await resolvePhpFpmPass(),
        },
      };
    }

    case "delete_domain": {
      const domain = sanitizeHostnameForPath(String(payload.domain));
      const configPath = path.join(CONFIG_ROOT, `${domain}.conf`);
      await fs.rm(configPath, { force: true });
      if (!isWindows) {
        await removeNginxSite(domain, DRY_RUN);
      }
      return { success: true };
    }

    case "create_subdomain": {
      const domain = sanitizeHostnameForPath(String(payload.domain));
      const subdomain = String(payload.subdomain);
      const documentRoot = resolveSubdomainRoot(
        String(payload.documentRoot ?? ""),
        domain,
        subdomain
      );
      const appType = String(payload.appType ?? (payload.phpEnabled === false ? "STATIC" : "PHP"));
      const phpEnabled = appType === "PHP";
      const upstreamPort = payload.upstreamPort
        ? Number(payload.upstreamPort)
        : null;
      await fs.mkdir(documentRoot, { recursive: true });
      const hostname = sanitizeHostnameForPath(`${subdomain}.${domain}`);
      if (!isWindows) {
        await ensureDefaultIndex(documentRoot, hostname);
        const certDir = `/etc/letsencrypt/live/${hostname}`;
        const hasCert =
          fsSync.existsSync(path.join(certDir, "fullchain.pem")) &&
          fsSync.existsSync(path.join(certDir, "privkey.pem"));

        let conf: string;
        if (isMailHostname(hostname)) {
          conf = hasCert
            ? buildMailProxyHttpsVhost([hostname], certDir)
            : buildMailProxyHttpVhost([hostname]);
        } else {
          const vhostOpts = await resolveVhostOptions(phpEnabled, {
            appType,
            upstreamPort,
          });
          conf = hasCert
            ? buildHttpsVhost([hostname], documentRoot, certDir, vhostOpts)
            : buildHttpVhost([hostname], documentRoot, vhostOpts);
        }
        await writeAndEnableNginxSite(hostname, conf, DRY_RUN);
      }
      return {
        success: true,
        data: {
          documentRoot,
          hostname,
          phpEnabled,
          appType,
          upstreamPort,
          phpFpm: await resolvePhpFpmPass(),
        },
      };
    }

    case "delete_subdomain": {
      const domain = sanitizeHostnameForPath(String(payload.domain));
      const subdomain = String(payload.subdomain);
      const hostname = sanitizeHostnameForPath(`${subdomain}.${domain}`);
      if (payload.deleteFiles && payload.documentRoot) {
        await fs.rm(assertSafeDocumentRoot(String(payload.documentRoot)), {
          recursive: true,
          force: true,
        });
      }
      if (!isWindows) {
        await removeNginxSite(hostname, DRY_RUN);
      }
      return { success: true };
    }

    case "ensure_mail_proxy": {
      const hostname = sanitizeHostnameForPath(
        String(payload.hostname ?? "").trim().toLowerCase()
      );
      if (!isMailHostname(hostname)) {
        return { success: false, error: "hostname must be a mail.* host" };
      }
      if (!isWindows) {
        const certDir = `/etc/letsencrypt/live/${hostname}`;
        const hasCert =
          fsSync.existsSync(path.join(certDir, "fullchain.pem")) &&
          fsSync.existsSync(path.join(certDir, "privkey.pem"));
        const conf = hasCert
          ? buildMailProxyHttpsVhost([hostname], certDir)
          : buildMailProxyHttpVhost([hostname]);
        await writeAndEnableNginxSite(hostname, conf, DRY_RUN);
      }
      return { success: true, data: { hostname } };
    }

    case "issue_ssl":
    case "renew_ssl": {
      const domain = sanitizeHostnameForPath(String(payload.domain));
      const subdomains = Array.isArray(payload.subdomains)
        ? payload.subdomains.map(String)
        : [];
      await ensureConfigDir();

      if (isWindows || DRY_RUN) {
        const now = new Date();
        const expires = new Date(now);
        expires.setDate(expires.getDate() + 90);
        await fs.writeFile(
          path.join(CONFIG_ROOT, `ssl-${domain}.txt`),
          `issued ${now.toISOString()}`,
          "utf8"
        );
        return {
          success: true,
          data: {
            issuedAt: now.toISOString(),
            expiresAt: expires.toISOString(),
          },
        };
      }

      const documentRoot = resolveSslDocumentRoot(
        domain,
        typeof payload.documentRoot === "string"
          ? payload.documentRoot
          : undefined
      );

      const result = await issueLetsEncrypt(
        domain,
        documentRoot,
        DRY_RUN,
        subdomains,
        payload.phpEnabled !== false && String(payload.appType ?? "PHP") === "PHP",
        {
          appType: payload.appType ? String(payload.appType) : undefined,
          upstreamPort: payload.upstreamPort ? Number(payload.upstreamPort) : null,
        }
      );
      await fs.writeFile(
        path.join(CONFIG_ROOT, `ssl-${domain}.txt`),
        `issued ${result.issuedAt}\nexpires ${result.expiresAt}\ncert ${result.certDir}\n`,
        "utf8"
      );
      return {
        success: true,
        data: {
          issuedAt: result.issuedAt,
          expiresAt: result.expiresAt,
        },
      };
    }

    case "ssl_cert_info": {
      const domain = String(payload.domain ?? "").trim().toLowerCase();
      if (!domain) {
        return { success: false, error: "domain required" };
      }
      if (isWindows || DRY_RUN) {
        return {
          success: true,
          data: { exists: false, issuedAt: null, expiresAt: null },
        };
      }
      const certDir = `/etc/letsencrypt/live/${domain}`;
      try {
        const dates = await readCertDates(certDir);
        return {
          success: true,
          data: {
            exists: true,
            issuedAt: dates.issuedAt,
            expiresAt: dates.expiresAt,
            certDir: dates.certDir,
          },
        };
      } catch {
        return {
          success: true,
          data: { exists: false, issuedAt: null, expiresAt: null, certDir },
        };
      }
    }

    case "create_mail_account": {
      const email = String(payload.email);
      const password = String(payload.password ?? "");
      await ensureConfigDir();
      if (!isWindows) {
        if (!password) {
          await provisionMailboxShell(email, DRY_RUN);
        } else {
          await createVirtualMailbox(email, password, DRY_RUN);
        }
      }
      await fs.appendFile(
        path.join(CONFIG_ROOT, "mail.map"),
        `mailbox ${email}\n`,
        "utf8"
      );
      return { success: true, data: { email } };
    }

    case "delete_mail_account": {
      const email = String(payload.email);
      if (!isWindows) {
        await deleteVirtualMailbox(email, DRY_RUN, true);
      }
      return { success: true };
    }

    case "reset_mail_password": {
      const email = String(payload.email);
      const password = String(payload.password ?? "");
      if (!password) {
        return { success: false, error: "Password required" };
      }
      await ensureConfigDir();
      if (!isWindows) {
        await resetVirtualMailboxPassword(email, password, DRY_RUN);
      }
      await fs.appendFile(
        path.join(CONFIG_ROOT, "mail.map"),
        `reset-password ${email}\n`,
        "utf8"
      );
      return { success: true, data: { email } };
    }

    case "set_mail_account_active": {
      const email = String(payload.email);
      const isActive = Boolean(payload.isActive);
      await ensureConfigDir();
      if (!isWindows) {
        await setVirtualMailboxActive(email, isActive, DRY_RUN);
      }
      await fs.appendFile(
        path.join(CONFIG_ROOT, "mail.map"),
        `${isActive ? "enable" : "disable"} ${email}\n`,
        "utf8"
      );
      return { success: true, data: { email, isActive } };
    }

    case "create_ftp_account": {
      const username = String(payload.username);
      const password = String(payload.password);
      const homeDir = String(payload.homeDir);
      const data = await createFtpAccountOnServer({
        username,
        password,
        homeDir,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "delete_ftp_account": {
      const username = String(payload.username);
      const data = await deleteFtpAccountOnServer({
        username,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "create_postgres_database": {
      const data = await createPostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        password: String(payload.password),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "delete_postgres_database": {
      const data = await deletePostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "reset_postgres_password": {
      const data = await resetPostgresPasswordOnServer({
        roleName: String(payload.roleName),
        password: String(payload.password),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "inspect_postgres_schema": {
      const data = await inspectPostgresSchemaOnServer({
        dbName: String(payload.dbName),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "preview_postgres_table": {
      const data = await previewPostgresTableOnServer({
        dbName: String(payload.dbName),
        schema: String(payload.schema || "public"),
        table: String(payload.table),
        limit:
          payload.limit !== undefined ? Number(payload.limit) : undefined,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "create_postgres_table": {
      const columns = Array.isArray(payload.columns)
        ? (payload.columns as Array<{
            name: string;
            type: string;
            nullable?: boolean;
            primaryKey?: boolean;
            defaultValue?: string | null;
          }>)
        : [];
      const data = await createPostgresTableOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        columns,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "delete_postgres_table": {
      const data = await deletePostgresTableOnServer({
        dbName: String(payload.dbName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "alter_postgres_table": {
      const addColumns = Array.isArray(payload.addColumns)
        ? (payload.addColumns as Array<{
            name: string;
            type: string;
            nullable?: boolean;
            primaryKey?: boolean;
            defaultValue?: string | null;
          }>)
        : [];
      const dropColumns = Array.isArray(payload.dropColumns)
        ? payload.dropColumns.map((c: unknown) => String(c))
        : [];
      const data = await alterPostgresTableOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        newName: payload.newName ? String(payload.newName) : undefined,
        addColumns,
        dropColumns,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "sync_dns_zone": {
      const data = payload as SyncDnsZonePayload & Action;
      const result = await applyDnsZone(
        DNS_ROOT,
        {
          domain: String(data.domain),
          serial: Number(data.serial),
          ns1: String(data.ns1),
          ns2: String(data.ns2),
          ipAddress: String(data.ipAddress),
          records: Array.isArray(data.records) ? data.records : [],
          zoneContent: String(data.zoneContent),
        },
        {
          dryRun: DRY_RUN,
          bindZonesDir: getBindZonesDir(),
          bindNamedDir: getBindNamedDir(),
          bindIncludeFile: getBindIncludeFile(),
          bindReloadCmd: getBindReloadCmd(),
        }
      );
      return { success: true, data: result };
    }

    case "delete_dns_zone": {
      const domain = String(payload.domain);
      await removeDnsZone(DNS_ROOT, domain, {
        dryRun: DRY_RUN,
        bindZonesDir: getBindZonesDir(),
        bindNamedDir: getBindNamedDir(),
        bindIncludeFile: getBindIncludeFile(),
        bindReloadCmd: getBindReloadCmd(),
      });
      return { success: true };
    }

    case "list_files": {
      const dirPath = String(payload.path);
      await fs.mkdir(dirPath, { recursive: true });
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const data = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          const stat = await fs.stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? "directory" : "file",
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        })
      );
      return { success: true, data: { entries: data } };
    }

    case "read_file": {
      const content = await fs.readFile(String(payload.path), "utf8");
      return { success: true, data: { content } };
    }

    case "write_file": {
      const filePath = String(payload.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, String(payload.content), "utf8");
      return { success: true };
    }

    case "delete_file": {
      await fs.unlink(String(payload.path));
      return { success: true };
    }

    case "create_directory": {
      const dir = assertSafeDocumentRoot(String(payload.path));
      await fs.mkdir(dir, { recursive: true });
      return { success: true };
    }

    case "delete_directory": {
      await fs.rm(String(payload.path), { recursive: true, force: true });
      return { success: true };
    }

    case "rename_path": {
      const source = String(payload.source);
      const dest = String(payload.dest);
      await fs.rename(source, dest);
      return { success: true };
    }

    case "move_path": {
      const source = String(payload.source);
      const destDir = String(payload.dest);
      const target = path.join(destDir, path.basename(source));
      await fs.rename(source, target);
      return { success: true };
    }

    case "copy_path": {
      const source = String(payload.source);
      const destDir = String(payload.dest);
      const target = path.join(destDir, path.basename(source));
      await fs.cp(source, target, { recursive: true });
      return { success: true };
    }

    case "upload_file": {
      return await writeUploadedFile(
        String(payload.path),
        Buffer.from(String(payload.contentBase64), "base64"),
        payload.removeZip !== false
      );
    }

    case "extract_zip": {
      const filePath = String(payload.path);
      const destDir = String(payload.dest || path.dirname(filePath));
      if (!isZipFileName(filePath)) {
        return { success: false, error: "Not a ZIP file" };
      }
      const result = await extractZipArchive(filePath, destDir, {
        removeZip: payload.removeZip === true,
      });
      return {
        success: true,
        data: {
          path: filePath,
          extractedTo: result.extractedTo,
          removedZip: result.removedZip,
        },
      };
    }

    case "read_file_binary": {
      const filePath = String(payload.path);
      const buf = await fs.readFile(filePath);
      return {
        success: true,
        data: {
          contentBase64: buf.toString("base64"),
          size: buf.length,
        },
      };
    }

    case "block_ip": {
      const ip = assertValidIpAddress(String(payload.ip));
      const reason = sanitizeBlockReason(
        String(payload.reason ?? "Naviyra security block")
      );
      if (!DRY_RUN && !isWindows) {
        await runCmd("ufw", ["deny", "from", ip]);
      } else {
        console.log(`[DRY RUN] block_ip ${ip}: ${reason}`);
      }
      await ensureConfigDir();
      const denyFile = path.join(CONFIG_ROOT, "blocked-ips.conf");
      let lines = "";
      try {
        lines = await fs.readFile(denyFile, "utf8");
      } catch {
        /* new file */
      }
      const denyLine = `deny ${ip}; # ${reason}`;
      if (!lines.split("\n").some((l) => l.startsWith(`deny ${ip};`))) {
        await fs.appendFile(denyFile, `${denyLine}\n`, "utf8");
      }
      return { success: true, data: { ip, dryRun: DRY_RUN } };
    }

    case "unblock_ip": {
      const ip = assertValidIpAddress(String(payload.ip));
      if (!DRY_RUN && !isWindows) {
        await runCmd("ufw", ["delete", "deny", "from", ip]).catch(() => undefined);
      } else {
        console.log(`[DRY RUN] unblock_ip ${ip}`);
      }
      const denyFile = path.join(CONFIG_ROOT, "blocked-ips.conf");
      try {
        const content = await fs.readFile(denyFile, "utf8");
        const next = content
          .split("\n")
          .filter((line) => !line.startsWith(`deny ${ip};`))
          .join("\n");
        await fs.writeFile(denyFile, next, "utf8");
      } catch {
        /* ignore missing file */
      }
      return { success: true, data: { ip, dryRun: DRY_RUN } };
    }

    case "configure_site_app": {
      const siteId = String(payload.siteId);
      const siteName = sanitizeHostnameForPath(String(payload.siteName));
      const documentRoot = assertSafeDocumentRoot(String(payload.documentRoot));
      const appType = String(payload.appType ?? "STATIC");
      const phpEnabled = appType === "PHP";
      let upstreamPort =
        payload.upstreamPort != null ? Number(payload.upstreamPort) : null;

      if (isProxyAppType(appType)) {
        upstreamPort = await allocateUpstreamPort(upstreamPort);
        const startCommand = String(payload.startCommand ?? "");
        await writeAppUnit({
          siteId,
          documentRoot,
          workingDirRel: String(payload.appWorkingDir ?? "."),
          startCommand,
          port: upstreamPort,
          appEnv: payload.appEnv != null ? String(payload.appEnv) : null,
          dryRun: DRY_RUN,
        });
      } else {
        await removeAppUnit(siteId, DRY_RUN).catch(() => undefined);
        upstreamPort = null;
      }

      const isSub = Boolean(payload.isSubdomain);
      if (isSub) {
        const certDir = `/etc/letsencrypt/live/${siteName}`;
        const hasCert =
          fsSync.existsSync(path.join(certDir, "fullchain.pem")) &&
          fsSync.existsSync(path.join(certDir, "privkey.pem"));
        let conf: string;
        if (isMailHostname(siteName)) {
          // Never replace mail.* webmail reverse-proxy with a document-root vhost
          conf = hasCert
            ? buildMailProxyHttpsVhost([siteName], certDir)
            : buildMailProxyHttpVhost([siteName]);
        } else {
          const vhostOpts = await resolveVhostOptions(phpEnabled, {
            appType,
            upstreamPort,
          });
          conf = hasCert
            ? buildHttpsVhost([siteName], documentRoot, certDir, vhostOpts)
            : buildHttpVhost([siteName], documentRoot, vhostOpts);
        }
        await writeAndEnableNginxSite(siteName, conf, DRY_RUN);
      } else {
        await writeVhostConfig(siteName, documentRoot, phpEnabled, {
          appType,
          upstreamPort,
        });
      }

      return {
        success: true,
        data: { siteId, appType, upstreamPort, phpEnabled },
      };
    }

    case "app_start": {
      const siteId = String(payload.siteId);
      const result = await startAppUnit(siteId, DRY_RUN);
      return { success: true, data: result };
    }

    case "app_stop": {
      const siteId = String(payload.siteId);
      const result = await stopAppUnit(siteId, DRY_RUN);
      return { success: true, data: result };
    }

    case "app_restart": {
      const siteId = String(payload.siteId);
      const result = await restartAppUnit(siteId, DRY_RUN);
      return { success: true, data: result };
    }

    case "refresh_websocket_proxies": {
      if (isWindows || DRY_RUN) {
        return {
          success: true,
          data: { skipped: true, reason: "linux live only" },
        };
      }
      const script = path.join(PROJECT_ROOT, "scripts", "install-websocket-map.sh");
      await runCmd("bash", [script]);
      return { success: true, data: { installed: true } };
    }

    case "app_status": {
      const siteId = String(payload.siteId);
      const result = await getAppUnitStatus(siteId);
      return { success: true, data: result };
    }

    case "app_remove": {
      const siteId = String(payload.siteId);
      await removeAppUnit(siteId, DRY_RUN);
      return { success: true, data: { siteId } };
    }

    case "run_backup": {
      const databases = Array.isArray(payload.databases)
        ? (payload.databases as Array<{
            domain?: string;
            dbName: string;
            roleName: string;
          }>)
        : [];
      const result = await runBackup({
        backupRoot: String(payload.backupRoot || "/var/backups/naviyra"),
        retainCount: Number(payload.retainCount ?? 7),
        includePanelDb: payload.includePanelDb !== false,
        includeSites: payload.includeSites !== false,
        includeDns: payload.includeDns !== false,
        includeMail: Boolean(payload.includeMail),
        includeDatabases: payload.includeDatabases !== false,
        databases,
        dryRun: DRY_RUN,
      });
      return { success: true, data: result };
    }

    case "run_domain_backup": {
      const databases = Array.isArray(payload.databases)
        ? (payload.databases as Array<{
            domain?: string;
            dbName: string;
            roleName: string;
          }>)
        : [];
      const result = await runDomainBackup({
        domain: String(payload.domain),
        backupRoot: String(payload.backupRoot || "/var/backups/naviyra"),
        retainCount: Number(payload.retainCount ?? 7),
        includeSites: payload.includeSites !== false,
        includeDns: payload.includeDns !== false,
        includeMail: payload.includeMail !== false,
        includeDatabases: payload.includeDatabases !== false,
        databases,
        dryRun: DRY_RUN,
      });
      return { success: true, data: result };
    }

    case "restore_backup": {
      const result = await restoreBackup({
        archivePath: String(payload.archivePath),
        allowedRoot: payload.allowedRoot
          ? String(payload.allowedRoot)
          : undefined,
        restorePanelDb: Boolean(payload.restorePanelDb),
        restoreSites: Boolean(payload.restoreSites),
        restoreDns: Boolean(payload.restoreDns),
        restoreMail: Boolean(payload.restoreMail),
        restoreDatabases: Boolean(payload.restoreDatabases),
        dryRun: DRY_RUN,
      });
      return { success: true, data: result };
    }

    case "restore_domain_backup": {
      const result = await restoreDomainBackup({
        archivePath: String(payload.archivePath),
        allowedRoot: payload.allowedRoot
          ? String(payload.allowedRoot)
          : undefined,
        domain: payload.domain ? String(payload.domain) : undefined,
        restoreSites: Boolean(payload.restoreSites),
        restoreDns: Boolean(payload.restoreDns),
        restoreMail: Boolean(payload.restoreMail),
        restoreDatabases: Boolean(payload.restoreDatabases),
        dryRun: DRY_RUN,
      });
      return { success: true, data: result };
    }

    case "delete_backup": {
      const result = await deleteBackup({
        archivePath: String(payload.archivePath),
        allowedRoot: payload.allowedRoot
          ? String(payload.allowedRoot)
          : undefined,
        dryRun: DRY_RUN,
      });
      return { success: true, data: result };
    }

    case "configure_backup_timer": {
      const schedule = String(
        payload.schedule || "DAILY_03"
      ) as BackupSchedulePreset;
      const result = await configureBackupTimer({
        enabled: Boolean(payload.enabled),
        schedule,
        panelPort: Number(
          payload.panelPort || process.env.PANEL_PORT || 3100
        ),
        workerToken: String(
          payload.workerToken ||
            process.env.BACKUP_WORKER_TOKEN ||
            process.env.AGENT_API_KEY ||
            API_KEY
        ),
        dryRun: DRY_RUN,
      });
      return { success: true, data: result };
    }

    default:
      return { success: false, error: `Unknown action: ${payload.action}` };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/execute") {
    if (!bearerTokenMatches(req.headers.authorization, API_KEY)) {
      return unauthorized(res);
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const payload = JSON.parse(body) as Action;
      const result = await handleAction(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Agent error",
        })
      );
    }
    return;
  }

  // Binary file upload (avoids base64 JSON bloat for large ZIPs)
  if (req.method === "POST" && req.url === "/upload-file") {
    if (!bearerTokenMatches(req.headers.authorization, API_KEY)) {
      return unauthorized(res);
    }
    const filePath = String(req.headers["x-naviyra-path"] ?? "").trim();
    if (!filePath || filePath.includes("\0")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Missing X-Naviyra-Path" }));
      return;
    }
    const removeZip = String(req.headers["x-naviyra-remove-zip"] ?? "1") !== "0";
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks);
      const result = await writeUploadedFile(filePath, content, removeZip);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Upload error",
        })
      );
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

attachTerminalWs(server, { dryRun: DRY_RUN });

const BIND_HOST = getAgentBindHost();
server.listen(PORT, BIND_HOST, async () => {
  await fs.mkdir(SITES_ROOT, { recursive: true });
  const admin = hasAdminPermission();
  console.log(
    `Naviyra agent listening on ${BIND_HOST}:${PORT} (dryRun=${DRY_RUN}, admin=${admin}, sites=${SITES_ROOT})`
  );
  if (!DRY_RUN && !admin && !isWindows) {
    console.warn("WARNING: Live mode needs root. Use: sudo ./start-admin.sh");
  }
});
