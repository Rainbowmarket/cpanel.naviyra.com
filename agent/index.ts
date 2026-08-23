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
  assertPathUnderTenantRoot,
  assertValidSubdomainLabels,
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
  ensureNaviyraVisitorLog,
  applyNginxUploadLimit,
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
  getAppLogs,
} from "./apps";
import {
  assertArchiveUnderAllowedRoot,
  configureBackupTimer,
  deleteBackup,
  restoreBackup,
  restoreDomainBackup,
  runBackup,
  runDomainBackup,
  writeBackupArchiveFile,
  type BackupSchedulePreset,
} from "./backup";
import { controlHostService, installHostService, listHostServices } from "./host-services";
import {
  createFtpAccountOnServer,
  deleteFtpAccountOnServer,
} from "./ftp";
import {
  exportPostgresDatabaseOnServer,
  importPostgresDatabaseOnServer,
  reassignPostgresOwnershipOnServer,
  postgresDatabaseExistsOnServer,
  createPostgresDatabaseOnServer,
  createPostgresTableOnServer,
  alterPostgresTableOnServer,
  deletePostgresDatabaseOnServer,
  deletePostgresTableOnServer,
  inspectPostgresSchemaOnServer,
  previewPostgresTableOnServer,
  queryPostgresSqlOnServer,
  mutatePostgresTableRowsOnServer,
  resetPostgresPasswordOnServer,
} from "./postgres";
import { redactPostgresError } from "./pg-bin";
import { inspectHostedDatabase, previewHostedTable, queryHostedSql } from "./db-engines";
import type { VhostOptions } from "./nginx";
import {
  listDockerContainers,
  controlDockerContainer,
  dockerContainerLogs,
  dockerComposeUp,
} from "./docker";
import { gitDeployOnServer } from "./git";
import { syncCronJobsOnServer } from "./cron";
import {
  initPluginRegistry,
  invokePlugin,
  listPluginManifests,
} from "./plugins/registry";
import type { PluginOp } from "./plugins/contract";
import { assertKnownAction, assertPluginId, redactAuditPayload } from "./actions";
import {
  assertAgentRateLimit,
  auditAgentEvent,
  clientIp,
  tooMany,
} from "./http-guard";
const exec = promisify(execFile);
const PORT = Number(process.env.AGENT_PORT ?? (process.platform === "linux" ? 4100 : 4000));
const isWindows = process.platform === "win32";
const DRY_RUN =
  process.env.AGENT_DRY_RUN === "true" ||
  (process.env.AGENT_DRY_RUN !== "false" && isWindows);

function hasAdminPermission(): boolean {
  if (isWindows) return false;
  return typeof process.getuid === "function" && process.getuid() === 0;
}

async function browseViaPlugin(
  engine: string,
  op: "inspect" | "preview" | "query",
  params: Record<string, unknown>
) {
  const result = await invokePlugin(engine, op, params, DRY_RUN);
  if (!result.ok) {
    throw new Error(result.detail ?? `${engine} ${op} failed`);
  }
  return result.data;
}

async function hostedOrPlugin<T>(
  engine: string,
  op: "inspect" | "preview" | "query",
  params: Record<string, unknown>,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      !/not available|Browse is not|Preview is not|SQL editor is not/i.test(msg)
    ) {
      throw error;
    }
    return (await browseViaPlugin(engine, op, params)) as T;
  }
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
  removeZip: boolean,
  tenantRoot?: string
) {
  const safePath = await assertPathUnderTenantRoot(filePath, tenantRoot);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, content);
  if (isZipFileName(safePath)) {
    const destDir = path.dirname(safePath);
    const result = await extractZipArchive(safePath, destDir, {
      removeZip,
    });
    return {
      success: true as const,
      data: {
        path: safePath,
        extracted: true,
        extractedTo: result.extractedTo,
        removedZip: result.removedZip,
      },
    };
  }
  return { success: true as const, data: { path: safePath } };
}

function tenantRootOf(payload: Action): string | undefined {
  const root = String(payload.root ?? "").trim();
  return root || undefined;
}

function headerString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
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
  const action = assertKnownAction(payload.action);
  payload.action = action;
  switch (action) {
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

    case "list_plugins": {
      const plugins = await listPluginManifests(DRY_RUN);
      return { success: true, data: { plugins } };
    }

    case "plugin_invoke": {
      const pluginId = assertPluginId(payload.pluginId);
      const op = String(payload.op ?? "health") as PluginOp;
      const params =
        payload.params && typeof payload.params === "object"
          ? (payload.params as Record<string, unknown>)
          : {};
      const result = await invokePlugin(pluginId, op, params, DRY_RUN);
      // Transport succeeded even when the plugin reports ok:false (e.g. health: not installed).
      return { success: true, data: result };
    }

    case "runtime_versions": {
      const versions: { node: string | null; python: string | null; go: string | null } = {
        node: null,
        python: null,
        go: null,
      };
      try {
        const { stdout } = await exec(process.execPath, ["-v"]);
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
      const subdomain = assertValidSubdomainLabels(String(payload.subdomain));
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
      const subdomain = assertValidSubdomainLabels(String(payload.subdomain));
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

      try {
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
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "SSL issue/renew failed",
        };
      }
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

    case "export_postgres_database": {
      const data = await exportPostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        format: payload.format === "custom" ? "custom" : "sql",
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "import_postgres_database": {
      const data = await importPostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        roleName: payload.roleName ? String(payload.roleName) : undefined,
        format: payload.format === "custom" ? "custom" : payload.format === "sql" ? "sql" : undefined,
        fileName: payload.fileName ? String(payload.fileName) : undefined,
        contentBase64: String(payload.contentBase64 || ""),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "reassign_postgres_ownership": {
      const data = await reassignPostgresOwnershipOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "postgres_database_exists": {
      const data = await postgresDatabaseExistsOnServer({
        dbName: String(payload.dbName),
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
        search: payload.search ? String(payload.search) : undefined,
        filterColumn: payload.filterColumn
          ? String(payload.filterColumn)
          : undefined,
        filterOp: payload.filterOp ? String(payload.filterOp) : undefined,
        filterValue: payload.filterValue
          ? String(payload.filterValue)
          : undefined,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "inspect_hosted_database": {
      const engine = String(payload.engine || "");
      const dbName = String(payload.dbName);
      const data = await hostedOrPlugin(
        engine,
        "inspect",
        { dbName },
        () =>
          inspectHostedDatabase({
            engine,
            dbName,
            dryRun: DRY_RUN,
          })
      );
      return { success: true, data };
    }

    case "preview_hosted_table": {
      const engine = String(payload.engine || "");
      const dbName = String(payload.dbName);
      const table = String(payload.table);
      const limit = payload.limit !== undefined ? Number(payload.limit) : undefined;
      const data = await hostedOrPlugin(
        engine,
        "preview",
        { dbName, table, limit },
        () =>
          previewHostedTable({
            engine,
            dbName,
            table,
            limit,
            dryRun: DRY_RUN,
          })
      );
      return { success: true, data };
    }

    case "query_hosted_sql": {
      const engine = String(payload.engine || "");
      const dbName = String(payload.dbName);
      const sql = String(payload.sql ?? "");
      const data = await hostedOrPlugin(
        engine,
        "query",
        { dbName, sql },
        () =>
          queryHostedSql({
            engine,
            dbName,
            sql,
            dryRun: DRY_RUN,
          })
      );
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

    case "mutate_postgres_table_rows": {
      const values =
        payload.values && typeof payload.values === "object"
          ? (payload.values as Record<string, unknown>)
          : {};
      const where =
        payload.where && typeof payload.where === "object"
          ? (payload.where as Record<string, unknown>)
          : {};
      const whereList = Array.isArray(payload.whereList)
        ? (payload.whereList as Record<string, unknown>[])
        : undefined;
      const data = await mutatePostgresTableRowsOnServer({
        dbName: String(payload.dbName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        op: String(payload.op) as "insert" | "update" | "delete",
        values,
        where,
        whereList,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "query_postgres_sql": {
      const data = await queryPostgresSqlOnServer({
        dbName: String(payload.dbName),
        sql: String(payload.sql || ""),
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
      const domain = sanitizeHostnameForPath(String(payload.domain));
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
      const dirPath = await assertPathUnderTenantRoot(String(payload.path), tenantRootOf(payload));
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
      const filePath = await assertPathUnderTenantRoot(String(payload.path), tenantRootOf(payload));
      const content = await fs.readFile(filePath, "utf8");
      return { success: true, data: { content } };
    }

    case "write_file": {
      const filePath = await assertPathUnderTenantRoot(String(payload.path), tenantRootOf(payload));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, String(payload.content), "utf8");
      return { success: true };
    }

    case "delete_file": {
      const filePath = await assertPathUnderTenantRoot(String(payload.path), tenantRootOf(payload));
      await fs.unlink(filePath);
      return { success: true };
    }

    case "create_directory": {
      const dir = await assertPathUnderTenantRoot(String(payload.path), tenantRootOf(payload));
      await fs.mkdir(dir, { recursive: true });
      return { success: true };
    }

    case "delete_directory": {
      const dir = await assertPathUnderTenantRoot(String(payload.path), tenantRootOf(payload));
      await fs.rm(dir, { recursive: true, force: true });
      return { success: true };
    }

    case "rename_path": {
      const root = tenantRootOf(payload);
      const source = await assertPathUnderTenantRoot(String(payload.source), root);
      const dest = await assertPathUnderTenantRoot(String(payload.dest), root);
      await fs.rename(source, dest);
      return { success: true };
    }

    case "move_path": {
      const root = tenantRootOf(payload);
      const source = await assertPathUnderTenantRoot(String(payload.source), root);
      const destDir = await assertPathUnderTenantRoot(String(payload.dest), root);
      const target = await assertPathUnderTenantRoot(
        path.join(destDir, path.basename(source)),
        root
      );
      await fs.rename(source, target);
      return { success: true };
    }

    case "copy_path": {
      const root = tenantRootOf(payload);
      const source = await assertPathUnderTenantRoot(String(payload.source), root);
      const destDir = await assertPathUnderTenantRoot(String(payload.dest), root);
      const target = await assertPathUnderTenantRoot(
        path.join(destDir, path.basename(source)),
        root
      );
      await fs.cp(source, target, { recursive: true });
      return { success: true };
    }

    case "upload_file": {
      return await writeUploadedFile(
        String(payload.path),
        Buffer.from(String(payload.contentBase64), "base64"),
        payload.removeZip !== false,
        tenantRootOf(payload)
      );
    }

    case "extract_zip": {
      const root = tenantRootOf(payload);
      const filePath = await assertPathUnderTenantRoot(String(payload.path), root);
      const destDir = await assertPathUnderTenantRoot(
        String(payload.dest || path.dirname(filePath)),
        root
      );
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
      const filePath = await assertPathUnderTenantRoot(String(payload.path), tenantRootOf(payload));
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

    case "app_logs": {
      const siteId = String(payload.siteId);
      const lines = payload.lines != null ? Number(payload.lines) : 80;
      const result = await getAppLogs(siteId, lines);
      return { success: true, data: result };
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

    case "set_nginx_upload_limit": {
      const maxMb = Number(payload.maxMb);
      const result = await applyNginxUploadLimit({
        maxMb,
        dryRun: DRY_RUN,
      });
      return { success: true, data: result };
    }

    case "docker_ps": {
      const data = await listDockerContainers({ dryRun: DRY_RUN });
      return { success: true, data };
    }

    case "docker_control": {
      const data = await controlDockerContainer({
        id: String(payload.id),
        op: String(payload.op) as "start" | "stop" | "restart",
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "docker_logs": {
      const data = await dockerContainerLogs({
        id: String(payload.id),
        lines: payload.lines !== undefined ? Number(payload.lines) : undefined,
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "docker_compose_up": {
      const data = await dockerComposeUp({
        composePath: String(payload.composePath),
        documentRoot: String(payload.documentRoot),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "git_deploy": {
      const data = await gitDeployOnServer({
        documentRoot: String(payload.documentRoot),
        repoUrl: String(payload.repoUrl),
        branch: String(payload.branch || "main"),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "sync_cron_jobs": {
      const jobs = Array.isArray(payload.jobs)
        ? (payload.jobs as Array<{
            id: string;
            schedule: string;
            command: string;
            enabled?: boolean;
          }>)
        : [];
      const data = await syncCronJobsOnServer({ jobs, dryRun: DRY_RUN });
      return { success: true, data };
    }

    case "list_host_services": {
      const data = await listHostServices({ dryRun: DRY_RUN });
      return { success: true, data };
    }

    case "control_host_service": {
      const data = await controlHostService({
        id: String(payload.id ?? ""),
        op: String(payload.op ?? "") as "start" | "stop" | "restart",
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    case "install_host_service": {
      const data = await installHostService({
        id: String(payload.id ?? ""),
        dryRun: DRY_RUN,
      });
      return { success: true, data };
    }

    default:
      return { success: false, error: `Unknown action: ${payload.action}` };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/plugins" || req.url?.startsWith("/plugins?"))) {
    if (!bearerTokenMatches(req.headers.authorization, API_KEY)) {
      return unauthorized(res);
    }
    try {
      const plugins = await listPluginManifests(DRY_RUN);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { plugins } }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Plugin list failed",
        })
      );
    }
    return;
  }

  if (req.method === "POST" && req.url === "/execute") {
    if (!bearerTokenMatches(req.headers.authorization, API_KEY)) {
      return unauthorized(res);
    }
    try {
      assertAgentRateLimit(req, "/execute");
    } catch (error) {
      return tooMany(res, error instanceof Error ? error.message : "Rate limit exceeded");
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 32 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Payload too large" }));
        return;
      }
    }

    const ip = clientIp(req);
    try {
      const payload = JSON.parse(body) as Action;
      const result = await handleAction(payload);
      auditAgentEvent({
        route: "/execute",
        ip,
        action: String(payload.action),
        ok: Boolean((result as { success?: boolean }).success !== false),
        payload: redactAuditPayload(payload),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      auditAgentEvent({
        route: "/execute",
        ip,
        ok: false,
        detail: error instanceof Error ? error.message : "Agent error",
      });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: redactPostgresError(
            error instanceof Error ? error.message : "Agent error"
          ),
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
    try {
      assertAgentRateLimit(req, "/upload-file");
    } catch (error) {
      return tooMany(res, error instanceof Error ? error.message : "Rate limit exceeded");
    }
    const filePath = headerString(req.headers["x-naviyra-path"]);
    if (!filePath || filePath.includes("\0")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Missing X-Naviyra-Path" }));
      return;
    }
    const tenantRoot = headerString(req.headers["x-naviyra-root"]);
    const removeZip = headerString(req.headers["x-naviyra-remove-zip"]) !== "0";
    const ip = clientIp(req);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > 512 * 1024 * 1024) {
          throw new Error("Upload too large");
        }
        chunks.push(buf);
      }
      const content = Buffer.concat(chunks);
      const result = await writeUploadedFile(
        filePath,
        content,
        removeZip,
        tenantRoot || undefined
      );
      auditAgentEvent({
        route: "/upload-file",
        ip,
        ok: true,
        detail: filePath,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      auditAgentEvent({
        route: "/upload-file",
        ip,
        ok: false,
        detail: error instanceof Error ? error.message : "Upload error",
      });
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

  if (req.method === "GET" && (req.url === "/download-backup" || req.url?.startsWith("/download-backup?"))) {
    if (!bearerTokenMatches(req.headers.authorization, API_KEY)) {
      return unauthorized(res);
    }
    try {
      assertAgentRateLimit(req, "/download-backup");
    } catch (error) {
      return tooMany(res, error instanceof Error ? error.message : "Rate limit exceeded");
    }
    const filePath = headerString(req.headers["x-naviyra-path"]);
    const allowedRoot = headerString(req.headers["x-naviyra-backup-root"]);
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Missing X-Naviyra-Path" }));
      return;
    }
    const ip = clientIp(req);
    try {
      const resolved = assertArchiveUnderAllowedRoot(
        filePath,
        allowedRoot || undefined
      );
      const stat = await fs.stat(resolved);
      auditAgentEvent({
        route: "/download-backup",
        ip,
        ok: true,
        detail: path.basename(resolved),
      });
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${path.basename(resolved)}"`,
        "Content-Length": String(stat.size),
      });
      fsSync.createReadStream(resolved).pipe(res);
    } catch (error) {
      auditAgentEvent({
        route: "/download-backup",
        ip,
        ok: false,
        detail: error instanceof Error ? error.message : "Download error",
      });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Download error",
        })
      );
    }
    return;
  }

  if (req.method === "POST" && req.url === "/upload-backup") {
    if (!bearerTokenMatches(req.headers.authorization, API_KEY)) {
      return unauthorized(res);
    }
    try {
      assertAgentRateLimit(req, "/upload-backup");
    } catch (error) {
      return tooMany(res, error instanceof Error ? error.message : "Rate limit exceeded");
    }
    const fileName = headerString(req.headers["x-naviyra-name"]);
    const allowedRoot = headerString(req.headers["x-naviyra-backup-root"]);
    if (!fileName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Missing X-Naviyra-Name" }));
      return;
    }
    const ip = clientIp(req);
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const result = await writeBackupArchiveFile({
        fileName,
        content: Buffer.concat(chunks),
        allowedRoot: allowedRoot || undefined,
        dryRun: DRY_RUN,
      });
      auditAgentEvent({
        route: "/upload-backup",
        ip,
        ok: true,
        detail: fileName,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      auditAgentEvent({
        route: "/upload-backup",
        ip,
        ok: false,
        detail: error instanceof Error ? error.message : "Upload error",
      });
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
  await initPluginRegistry();
  await fs.mkdir(SITES_ROOT, { recursive: true });
  const admin = hasAdminPermission();
  console.log(
    `Naviyra agent listening on ${BIND_HOST}:${PORT} (dryRun=${DRY_RUN}, admin=${admin}, sites=${SITES_ROOT})`
  );
  if (!DRY_RUN && !admin && !isWindows) {
    console.warn("WARNING: Live mode needs root. Use: sudo ./start-admin.sh");
  }
  if (!DRY_RUN && admin && !isWindows) {
    try {
      await ensureNaviyraVisitorLog();
      await exec("nginx", ["-t"]);
      await exec("systemctl", ["reload", "nginx"]).catch(() => undefined);
    } catch (error) {
      console.warn("[nginx] visitor log setup failed", error);
    }
    try {
      let timerOn = false;
      try {
        const { stdout } = await exec("systemctl", [
          "is-enabled",
          "naviyra-visitor-ingest.timer",
        ]);
        timerOn = String(stdout).includes("enabled");
      } catch {
        timerOn = false;
      }
      const ingest = path.join(PROJECT_ROOT, "scripts", "install-visitor-ingest.sh");
      if (!timerOn && fsSync.existsSync(ingest)) {
        await exec("bash", [ingest, PROJECT_ROOT]);
        console.log("[ingest] visitor ingest timer enabled");
      }
    } catch (error) {
      console.warn("[ingest] enable failed", error);
    }
  }
});
