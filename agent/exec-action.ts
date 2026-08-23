/**
 * One-shot agent actions for the panel local fallback (no HTTP server).
 * Reads one JSON action from stdin, prints JSON { success, data?, error? }.
 */
import {
  exportPostgresDatabaseOnServer,
  importPostgresDatabaseOnServer,
  reassignPostgresOwnershipOnServer,
  postgresDatabaseExistsOnServer,
  createPostgresDatabaseOnServer,
  deletePostgresDatabaseOnServer,
  resetPostgresPasswordOnServer,
  inspectPostgresSchemaOnServer,
  previewPostgresTableOnServer,
  queryPostgresSqlOnServer,
  mutatePostgresTableRowsOnServer,
  createPostgresTableOnServer,
  deletePostgresTableOnServer,
  alterPostgresTableOnServer,
} from "./postgres";
import { redactPostgresError } from "./pg-bin";
import {
  listDockerContainers,
  controlDockerContainer,
  dockerContainerLogs,
  dockerComposeUp,
} from "./docker";
import { gitDeployOnServer } from "./git";
import { syncCronJobsOnServer } from "./cron";
import { controlHostService, installHostService, listHostServices } from "./host-services";

const DRY_RUN =
  process.env.AGENT_DRY_RUN === "true" ||
  (process.env.AGENT_DRY_RUN !== "false" && process.platform === "win32");

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Payload = {
  action: string;
  [key: string]: unknown;
};

async function run(payload: Payload) {
  switch (payload.action) {
    case "export_postgres_database":
      return exportPostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        format: payload.format === "custom" ? "custom" : "sql",
        dryRun: DRY_RUN,
      });
    case "import_postgres_database":
      return importPostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        roleName: payload.roleName ? String(payload.roleName) : undefined,
        format: payload.format === "custom" ? "custom" : payload.format === "sql" ? "sql" : undefined,
        fileName: payload.fileName ? String(payload.fileName) : undefined,
        contentBase64: String(payload.contentBase64 || ""),
        dryRun: DRY_RUN,
      });
    case "reassign_postgres_ownership":
      return reassignPostgresOwnershipOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        dryRun: DRY_RUN,
      });
    case "postgres_database_exists":
      return postgresDatabaseExistsOnServer({
        dbName: String(payload.dbName),
        dryRun: DRY_RUN,
      });
    case "create_postgres_database":
      return createPostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        password: String(payload.password),
        dryRun: DRY_RUN,
      });
    case "delete_postgres_database":
      return deletePostgresDatabaseOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        dryRun: DRY_RUN,
      });
    case "reset_postgres_password":
      return resetPostgresPasswordOnServer({
        roleName: String(payload.roleName),
        password: String(payload.password),
        dryRun: DRY_RUN,
      });
    case "inspect_postgres_schema":
      return inspectPostgresSchemaOnServer({
        dbName: String(payload.dbName),
        dryRun: DRY_RUN,
      });
    case "preview_postgres_table":
      return previewPostgresTableOnServer({
        dbName: String(payload.dbName),
        schema: String(payload.schema || "public"),
        table: String(payload.table),
        limit: payload.limit !== undefined ? Number(payload.limit) : undefined,
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
      return createPostgresTableOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        columns,
        dryRun: DRY_RUN,
      });
    }
    case "delete_postgres_table":
      return deletePostgresTableOnServer({
        dbName: String(payload.dbName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        dryRun: DRY_RUN,
      });
    case "alter_postgres_table":
      return alterPostgresTableOnServer({
        dbName: String(payload.dbName),
        roleName: String(payload.roleName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        newName: payload.newName ? String(payload.newName) : undefined,
        addColumns: Array.isArray(payload.addColumns)
          ? (payload.addColumns as Array<{
              name: string;
              type: string;
              nullable?: boolean;
              primaryKey?: boolean;
              defaultValue?: string | null;
            }>)
          : undefined,
        dropColumns: Array.isArray(payload.dropColumns)
          ? payload.dropColumns.map((name) => String(name))
          : undefined,
        dryRun: DRY_RUN,
      });
    case "mutate_postgres_table_rows":
      return mutatePostgresTableRowsOnServer({
        dbName: String(payload.dbName),
        schema: payload.schema ? String(payload.schema) : "public",
        table: String(payload.table),
        op: String(payload.op) as "insert" | "update" | "delete",
        values:
          payload.values && typeof payload.values === "object"
            ? (payload.values as Record<string, unknown>)
            : {},
        where:
          payload.where &&
          typeof payload.where === "object" &&
          !Array.isArray(payload.where)
            ? (payload.where as Record<string, unknown>)
            : {},
        whereList: Array.isArray(payload.whereList)
          ? (payload.whereList as Record<string, unknown>[])
          : undefined,
        dryRun: DRY_RUN,
      });
    case "query_postgres_sql":
      return queryPostgresSqlOnServer({
        dbName: String(payload.dbName),
        sql: String(payload.sql || ""),
        dryRun: DRY_RUN,
      });
    case "docker_ps":
      return listDockerContainers({ dryRun: DRY_RUN });
    case "docker_control":
      return controlDockerContainer({
        id: String(payload.id),
        op: String(payload.op) as "start" | "stop" | "restart",
        dryRun: DRY_RUN,
      });
    case "docker_logs":
      return dockerContainerLogs({
        id: String(payload.id),
        lines: payload.lines !== undefined ? Number(payload.lines) : undefined,
        dryRun: DRY_RUN,
      });
    case "docker_compose_up":
      return dockerComposeUp({
        composePath: String(payload.composePath),
        documentRoot: String(payload.documentRoot),
        dryRun: DRY_RUN,
      });
    case "git_deploy":
      return gitDeployOnServer({
        documentRoot: String(payload.documentRoot),
        repoUrl: String(payload.repoUrl),
        branch: String(payload.branch || "main"),
        dryRun: DRY_RUN,
      });
    case "sync_cron_jobs":
      return syncCronJobsOnServer({
        jobs: Array.isArray(payload.jobs)
          ? (payload.jobs as Array<{
              id: string;
              schedule: string;
              command: string;
              enabled?: boolean;
            }>)
          : [],
        dryRun: DRY_RUN,
      });
    case "list_host_services":
      return listHostServices({ dryRun: DRY_RUN });
    case "control_host_service":
      return controlHostService({
        id: String(payload.id ?? ""),
        op: String(payload.op ?? "") as "start" | "stop" | "restart",
        dryRun: DRY_RUN,
      });
    case "install_host_service":
      return installHostService({
        id: String(payload.id ?? ""),
        dryRun: DRY_RUN,
      });
    case "issue_ssl":
    case "renew_ssl": {
      const { issueLetsEncrypt } = await import("./nginx");
      const { sanitizeHostnameForPath } = await import("./hostname");
      const domain = sanitizeHostnameForPath(String(payload.domain ?? ""));
      const extra = Array.isArray(payload.subdomains)
        ? payload.subdomains.map(String)
        : [];
      const documentRoot =
        typeof payload.documentRoot === "string" && payload.documentRoot
          ? payload.documentRoot
          : `/var/www/${domain}/public_html`;
      return issueLetsEncrypt(
        domain,
        documentRoot,
        DRY_RUN,
        extra,
        payload.phpEnabled !== false && String(payload.appType ?? "PHP") === "PHP",
        {
          appType: payload.appType ? String(payload.appType) : undefined,
          upstreamPort: payload.upstreamPort ? Number(payload.upstreamPort) : null,
        }
      );
    }
    case "ssl_cert_info": {
      const { readCertDates } = await import("./nginx");
      const domain = String(payload.domain ?? "").trim().toLowerCase();
      const certDir = `/etc/letsencrypt/live/${domain}`;
      try {
        const dates = await readCertDates(certDir);
        return { exists: true, ...dates };
      } catch {
        return { exists: false, issuedAt: null, expiresAt: null, certDir };
      }
    }
    case "ensure_mail_proxy": {
      const { sanitizeHostnameForPath } = await import("./hostname");
      const {
        isMailHostname,
        buildMailProxyHttpVhost,
        buildMailProxyHttpsVhost,
        writeAndEnableNginxSite,
      } = await import("./nginx");
      const hostname = sanitizeHostnameForPath(
        String(payload.hostname ?? "").trim().toLowerCase()
      );
      if (!isMailHostname(hostname)) {
        throw new Error("hostname must be a mail.* host");
      }
      const certDir = `/etc/letsencrypt/live/${hostname}`;
      const fsSync = await import("node:fs");
      const hasCert =
        fsSync.existsSync(`${certDir}/fullchain.pem`) &&
        fsSync.existsSync(`${certDir}/privkey.pem`);
      const conf = hasCert
        ? buildMailProxyHttpsVhost([hostname], certDir)
        : buildMailProxyHttpVhost([hostname]);
      await writeAndEnableNginxSite(hostname, conf, DRY_RUN);
      return { hostname };
    }
    default:
      throw new Error(`Unsupported one-shot action: ${payload.action}`);
  }
}

async function main() {
  const raw = (await readStdin()).trim();
  if (!raw) {
    process.stdout.write(JSON.stringify({ success: false, error: "Empty action payload" }));
    process.exit(1);
  }
  const payload = JSON.parse(raw) as Payload;
  try {
    const data = await run(payload);
    process.stdout.write(JSON.stringify({ success: true, data }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        success: false,
        error: redactPostgresError(
          error instanceof Error ? error.message : "PostgreSQL action failed"
        ),
      })
    );
    process.exit(1);
  }
}

main();
