import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPostgresDatabaseOnServer,
  deletePostgresDatabaseOnServer,
  exportPostgresDatabaseOnServer,
  importPostgresDatabaseOnServer,
  inspectPostgresSchemaOnServer,
  previewPostgresTableOnServer,
  queryPostgresSqlOnServer,
} from "../postgres";
import { ensurePostgresReady, findPgBin } from "../pg-bin";
import { installPackages, prepareClickHouseRepo, prepareMongoRepo, runHostCommand, runPanelScript, whichBin } from "../pkg-install";
import * as engines from "../db-engines";
import type {
  AgentPlugin,
  PluginHandler,
  PluginManifest,
  PluginOp,
} from "./contract";

const HEALTH_CAP = [
  { op: "health" as const, label: "Health check" },
  { op: "install" as const, label: "Install" },
  { op: "configure" as const, label: "Configure" },
];

const DB_CAPS = [
  ...HEALTH_CAP,
  { op: "create" as const, label: "Create database" },
  { op: "delete" as const, label: "Delete database" },
  { op: "backup" as const, label: "Backup" },
  { op: "restore" as const, label: "Restore" },
  { op: "inspect" as const, label: "Inspect schema" },
  { op: "preview" as const, label: "Preview rows" },
  { op: "query" as const, label: "Run query" },
];

const plugins = new Map<string, AgentPlugin>();

const RUNTIME_PACKAGES: Record<string, InstallSpec> = {
  node: { packageSets: [["nodejs", "npm"]] },
  python: { packageSets: [["python3", "python3-venv", "python3-pip"]] },
  php: { packageSets: [["php-fpm", "php-cli", "php-mysql", "php-xml", "php-mbstring", "php-curl", "php-zip"]], script: "install-php-fpm.sh" },
  go: { packageSets: [["golang-go"]] },
  bun: { packageSets: [["unzip", "curl"]] },
  deno: { packageSets: [["unzip", "curl"]] },
  java: { packageSets: [["default-jdk"], ["java-17-openjdk"]] },
  dotnet: { packageSets: [["dotnet-sdk-8.0"], ["dotnet-sdk-6.0"]] },
};

async function which(bin: string): Promise<string | null> {
  return whichBin(bin);
}

type InstallSpec = {
  packageSets: string[][];
  services?: string[];
  script?: string;
  /** Run after packages succeed (e.g. phpMyAdmin for MySQL). */
  postScript?: string;
  prepare?: () => Promise<void>;
};

async function doInstall(
  name: string,
  spec: InstallSpec,
  dryRun: boolean
): Promise<{ ok: boolean; installed: boolean; detail: string }> {
  const notes: string[] = [];
  try {
    if (!dryRun && spec.prepare) {
      await spec.prepare();
    }
    if (spec.script) {
      try {
        const ran = await runPanelScript(spec.script, dryRun);
        if (ran) notes.push(ran.detail);
      } catch (error) {
        notes.push(
          `script ${spec.script} failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    try {
      const result = await installPackages({
        dryRun,
        name,
        packageSets: spec.packageSets,
        services: spec.services,
      });
      notes.push(result.detail);
      if (spec.postScript) {
        try {
          const ran = await runPanelScript(spec.postScript, dryRun);
          if (ran) notes.push(ran.detail);
        } catch (error) {
          notes.push(
            `postScript ${spec.postScript} failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      return { ok: true, installed: true, detail: notes.join(". ") };
    } catch (error) {
      const aptMsg = error instanceof Error ? error.message : `Failed to install ${name}`;
      if (notes.some((n) => n.startsWith("Ran scripts/"))) {
        return { ok: true, installed: true, detail: `${notes.join(". ")}. apt: ${aptMsg}` };
      }
      return {
        ok: false,
        installed: false,
        detail: notes.length ? `${notes.join(". ")}. ${aptMsg}` : aptMsg,
      };
    }
  } catch (error) {
    return {
      ok: false,
      installed: false,
      detail: error instanceof Error ? error.message : `Failed to install ${name}`,
    };
  }
}

function dbEnginePlugin(input: {
  id: string;
  name: string;
  description: string;
  spec: InstallSpec;
  probe: () => Promise<{ ok: boolean; detail: string }>;
  create: PluginHandler;
  remove: PluginHandler;
  reset?: PluginHandler;
}): AgentPlugin {
  const handler: PluginHandler = async (op, params, ctx) => {
    if (op === "health") {
      const health = await input.probe();
      return { ok: health.ok, installed: health.ok, detail: health.detail };
    }
    if (op === "install") {
      const installed = await input.probe();
      if (installed.ok) {
        return { ok: true, installed: true, detail: `${input.name} is already installed (${installed.detail})` };
      }
      const result = await doInstall(input.name, input.spec, ctx.dryRun);
      if (!result.ok) return result;
      const again = await input.probe();
      return {
        ok: again.ok || ctx.dryRun,
        installed: again.ok || ctx.dryRun,
        detail: again.ok
          ? `${result.detail}. Ready at ${again.detail}`
          : `${result.detail}. Health check: ${again.detail}`,
      };
    }
    if (op === "configure") {
      if (input.reset && String(params.action ?? "") === "reset_password") {
        return input.reset(op, params, ctx);
      }
      const health = await input.probe();
      return { ok: health.ok, installed: health.ok, detail: health.detail };
    }
    if (op === "create") {
      try {
        return await input.create(op, params, ctx);
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "Create failed",
        };
      }
    }
    if (op === "delete") {
      try {
        return await input.remove(op, params, ctx);
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "Delete failed",
        };
      }
    }
    if (op === "inspect") {
      try {
        const data = await engines.inspectHostedDatabase({
          engine: input.id,
          dbName: String(params.dbName ?? ""),
          dryRun: ctx.dryRun,
        });
        return { ok: true, installed: true, data };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "Inspect failed",
        };
      }
    }
    if (op === "preview") {
      try {
        const data = await engines.previewHostedTable({
          engine: input.id,
          dbName: String(params.dbName ?? ""),
          table: String(params.table ?? ""),
          limit: params.limit !== undefined ? Number(params.limit) : undefined,
          dryRun: ctx.dryRun,
        });
        return { ok: true, installed: true, data };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "Preview failed",
        };
      }
    }
    if (op === "query") {
      try {
        const data = await engines.queryHostedSql({
          engine: input.id,
          dbName: String(params.dbName ?? ""),
          sql: String(params.sql ?? ""),
          dryRun: ctx.dryRun,
        });
        return { ok: true, installed: true, data };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "Query failed",
        };
      }
    }
    return { ok: false, detail: `${input.name} does not implement '${op}'` };
  };
  return {
    id: input.id,
    name: input.name,
    kind: "database",
    description: input.description,
    capabilities: DB_CAPS,
    handler,
  };
}

function postgresPlugin(): AgentPlugin {
  const handler: PluginHandler = async (op, params, ctx) => {
    if (op === "health") {
      try {
        if (ctx.dryRun) {
          return { ok: true, installed: true, detail: "dry-run (PostgreSQL assumed)" };
        }
        const psql = findPgBin("psql");
        if (!psql) {
          return { ok: false, installed: false, detail: "PostgreSQL client (psql) is not installed" };
        }
        return { ok: true, installed: true, detail: psql };
      } catch (error) {
        return {
          ok: false,
          installed: false,
          detail: error instanceof Error ? error.message : "PostgreSQL is not ready",
        };
      }
    }
    if (op === "install") {
      try {
        if (ctx.dryRun) {
          return { ok: true, installed: true, detail: "dry-run (PostgreSQL assumed)" };
        }
        const existing = findPgBin("psql");
        if (existing) {
          const bins = await ensurePostgresReady();
          let extra = "";
          try {
            const ran = await runPanelScript("install-phppgadmin.sh", ctx.dryRun);
            if (ran) extra = `. ${ran.detail}`;
          } catch (error) {
            extra = `. phpPgAdmin: ${error instanceof Error ? error.message : String(error)}`;
          }
          return { ok: true, installed: true, detail: `${bins.psql}${extra}` };
        }
        const result = await doInstall(
          "PostgreSQL",
          {
            packageSets: [["postgresql", "postgresql-contrib"]],
            services: ["postgresql"],
            script: "install-postgres.sh",
            postScript: "install-phppgadmin.sh",
          },
          ctx.dryRun
        );
        if (!result.ok) return result;
        const bins = await ensurePostgresReady();
        return { ok: true, installed: true, detail: `${result.detail}. ${bins.psql}` };
      } catch (error) {
        return {
          ok: false,
          installed: false,
          detail: error instanceof Error ? error.message : "PostgreSQL install failed",
        };
      }
    }
    if (op === "configure") {
      return { ok: true, installed: true, detail: "Uses CUSTOMER_POSTGRES_* on the agent host" };
    }
    if (op === "create") {
      const data = await createPostgresDatabaseOnServer({
        dbName: String(params.dbName ?? ""),
        roleName: String(params.roleName ?? ""),
        password: String(params.password ?? ""),
        dryRun: ctx.dryRun,
      });
      return { ok: true, installed: true, data };
    }
    if (op === "delete") {
      const data = await deletePostgresDatabaseOnServer({
        dbName: String(params.dbName ?? ""),
        roleName: String(params.roleName ?? ""),
        dryRun: ctx.dryRun,
      });
      return { ok: true, installed: true, data };
    }
    if (op === "backup") {
      const data = await exportPostgresDatabaseOnServer({
        dbName: String(params.dbName ?? ""),
        format: params.format === "custom" ? "custom" : "sql",
        dryRun: ctx.dryRun,
      });
      return { ok: true, installed: true, data };
    }
    if (op === "restore") {
      const data = await importPostgresDatabaseOnServer({
        dbName: String(params.dbName ?? ""),
        roleName: params.roleName ? String(params.roleName) : undefined,
        format: params.format === "custom" ? "custom" : "sql",
        fileName: params.fileName ? String(params.fileName) : undefined,
        contentBase64: String(params.contentBase64 ?? ""),
        dryRun: ctx.dryRun,
      });
      return { ok: true, installed: true, data };
    }
    if (op === "inspect") {
      const data = await inspectPostgresSchemaOnServer({
        dbName: String(params.dbName ?? ""),
        dryRun: ctx.dryRun,
      });
      return { ok: true, installed: true, data };
    }
    if (op === "preview") {
      const data = await previewPostgresTableOnServer({
        dbName: String(params.dbName ?? ""),
        schema: params.schema ? String(params.schema) : "public",
        table: String(params.table ?? ""),
        limit: params.limit !== undefined ? Number(params.limit) : undefined,
        search: params.search ? String(params.search) : undefined,
        filterColumn: params.filterColumn ? String(params.filterColumn) : undefined,
        filterOp: params.filterOp === "equals" ? "equals" : "contains",
        filterValue: params.filterValue ? String(params.filterValue) : undefined,
        dryRun: ctx.dryRun,
      });
      return { ok: true, installed: true, data };
    }
    if (op === "query") {
      const data = await queryPostgresSqlOnServer({
        dbName: String(params.dbName ?? ""),
        sql: String(params.sql ?? ""),
        dryRun: ctx.dryRun,
      });
      return { ok: true, installed: true, data };
    }
    return { ok: false, detail: `Unsupported op ${op}` };
  };
  return {
    id: "postgres",
    name: "PostgreSQL",
    kind: "database",
    description: "Customer Postgres on this node (create, dump, restore, health).",
    capabilities: DB_CAPS,
    handler,
  };
}

function binaryRuntime(id: string, name: string, bins: string[], description: string): AgentPlugin {
  const handler: PluginHandler = async (op, _params, ctx) => {
    let found: string | null = null;
    for (const bin of bins) {
      found = await which(bin);
      if (found) break;
    }
    if (op === "health") {
      return found
        ? { ok: true, installed: true, detail: found }
        : { ok: false, installed: false, detail: `${name} binary not found (${bins.join(", ")})` };
    }
    if (op === "install") {
      if (found) {
        return { ok: true, installed: true, detail: `${name} already present at ${found}` };
      }
      const spec = RUNTIME_PACKAGES[id];
      if (!spec) {
        return {
          ok: false,
          installed: false,
          detail: `No package mapping for ${name}. Install it on the host, then Check health.`,
        };
      }
      const result = await doInstall(name, spec, ctx.dryRun);
      if (!ctx.dryRun && !(await which(bins[0])) && (id === "bun" || id === "deno")) {
        try {
          const cmd =
            id === "bun"
              ? "curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash"
              : "curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh";
          await runHostCommand("bash", ["-lc", cmd], { timeout: 180000 });
        } catch {
          /* installer may fail offline */
        }
      }
      const again =
        (await which(bins[0])) ||
        (fsSync.existsSync(`/usr/local/bin/${bins[0]}`)
          ? `/usr/local/bin/${bins[0]}`
          : null);
      return {
        ok: Boolean(again) || result.ok,
        installed: Boolean(again) || result.ok,
        detail: again ? `${result.detail}. ${again}` : result.detail,
      };
    }
    return { ok: Boolean(found), installed: Boolean(found), detail: found ?? "not installed" };
  };
  return { id, name, kind: "runtime", description, capabilities: HEALTH_CAP, handler };
}

function servicePlugin(
  id: string,
  name: string,
  description: string,
  probe: () => Promise<{ ok: boolean; detail: string }>,
  spec?: InstallSpec
): AgentPlugin {
  const handler: PluginHandler = async (op, _params, ctx) => {
    const health = await probe();
    if (op === "health") {
      return { ok: health.ok, installed: health.ok, detail: health.detail };
    }
    if (op === "install") {
      if (health.ok) {
        return { ok: true, installed: true, detail: health.detail };
      }
      if (!spec) {
        return {
          ok: false,
          installed: false,
          detail: `${name} is not on this node. Install packages on the host, then Check health.`,
        };
      }
      const result = await doInstall(name, spec, ctx.dryRun);
      const again = await probe();
      return {
        ok: again.ok || ctx.dryRun,
        installed: again.ok || ctx.dryRun,
        detail: again.ok ? `${result.detail}. ${again.detail}` : result.detail,
      };
    }
    return { ok: health.ok, installed: health.ok, detail: health.detail };
  };
  return { id, name, kind: "service", description, capabilities: HEALTH_CAP, handler };
}

function localBackupPlugin(): AgentPlugin {
  const handler: PluginHandler = async (op) => {
    if (op === "health" || op === "install" || op === "configure") {
      return {
        ok: true,
        installed: true,
        detail: "Local archives via the agent backup root on this node",
      };
    }
    return {
      ok: false,
      detail: "Use panel Backups (run_domain_backup / restore_domain_backup) for this node",
    };
  };
  return {
    id: "backup-local",
    name: "Local backups",
    kind: "backup",
    description: "Tar archives on this server’s backup root.",
    capabilities: HEALTH_CAP,
    handler,
  };
}

function register(plugin: AgentPlugin) {
  plugins.set(plugin.id, plugin);
}

export function getPlugin(id: string) {
  return plugins.get(id) ?? null;
}

export async function listPluginManifests(dryRun: boolean): Promise<PluginManifest[]> {
  if (plugins.size === 0) await initPluginRegistry();
  const out: PluginManifest[] = [];
  for (const plugin of plugins.values()) {
    let installed = false;
    let health: string | undefined;
    try {
      const result = await plugin.handler("health", {}, { dryRun });
      installed = Boolean(result.installed ?? result.ok);
      health = result.detail;
    } catch (error) {
      health = error instanceof Error ? error.message : "health failed";
    }
    out.push({
      id: plugin.id,
      name: plugin.name,
      kind: plugin.kind,
      description: plugin.description,
      capabilities: plugin.capabilities,
      installed,
      health,
    } as PluginManifest & { installed: boolean; health?: string });
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export async function invokePlugin(
  pluginId: string,
  op: PluginOp,
  params: Record<string, unknown>,
  dryRun: boolean
) {
  const plugin = plugins.get(pluginId);
  if (!plugin) {
    if (plugins.size === 0) await initPluginRegistry();
  }
  const resolved = plugins.get(pluginId);
  if (!resolved) throw new Error(`Unknown plugin: ${pluginId}`);
  if (!resolved.capabilities.some((c) => c.op === op)) {
    throw new Error(`Plugin ${pluginId} does not advertise '${op}'`);
  }
  return resolved.handler(op, params, { dryRun });
}

async function loadContrib() {
  const contribDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "contrib");
  if (!fsSync.existsSync(contribDir)) return;
  const files = await fs.readdir(contribDir);
  for (const file of files) {
    if (!/\.(ts|js|mjs)$/.test(file) || file.startsWith("_")) continue;
    try {
      const href = pathToFileURL(path.join(contribDir, file)).href;
      const mod = (await import(href)) as { default?: AgentPlugin };
      if (mod.default?.id && typeof mod.default.handler === "function") {
        register(mod.default);
      }
    } catch (error) {
      console.warn("[plugins] contrib load failed", file, error);
    }
  }
}

export async function initPluginRegistry() {
  plugins.clear();
  register(postgresPlugin());
  register(
    dbEnginePlugin({
      id: "mysql",
      name: "MySQL",
      description: "MySQL server on this node. Create databases from Databases in the panel.",
      spec: {
        packageSets: [["mysql-server", "mysql-client"], ["default-mysql-server", "default-mysql-client"]],
        services: ["mysql", "mysqld"],
        postScript: "install-phpmyadmin.sh",
      },
      probe: engines.probeMysql,
      create: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.createMysqlDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? params.dbName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      remove: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.deleteMysqlDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      reset: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.resetMysqlPassword({
          roleName: String(params.roleName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
    })
  );
  register(
    dbEnginePlugin({
      id: "mariadb",
      name: "MariaDB",
      description: "MariaDB server on this node. Create databases from Databases in the panel.",
      spec: {
        packageSets: [["mariadb-server", "mariadb-client"]],
        services: ["mariadb", "mysql"],
        postScript: "install-phpmyadmin.sh",
      },
      probe: engines.probeMysql,
      create: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.createMysqlDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? params.dbName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
          mariadb: true,
        }),
      }),
      remove: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.deleteMysqlDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      reset: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.resetMysqlPassword({
          roleName: String(params.roleName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
    })
  );
  register(
    dbEnginePlugin({
      id: "mongodb",
      name: "MongoDB",
      description: "MongoDB on this node. Create databases from Databases in the panel.",
      spec: {
        packageSets: [["mongodb-org"], ["mongodb"], ["mongodb-server", "mongodb-clients"]],
        services: ["mongod", "mongodb"],
        prepare: prepareMongoRepo,
      },
      probe: engines.probeMongo,
      create: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.createMongoDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? params.dbName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      remove: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.deleteMongoDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
    })
  );
  register(
    dbEnginePlugin({
      id: "redis",
      name: "Redis",
      description: "Redis on this node. Create ACL users from Databases in the panel.",
      spec: {
        packageSets: [["redis-server", "redis-tools"]],
        services: ["redis-server", "redis"],
      },
      probe: engines.probeRedis,
      create: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.createRedisUser({
          roleName: String(params.roleName ?? params.dbName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      remove: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.deleteRedisUser({
          roleName: String(params.roleName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
    })
  );
  register(
    dbEnginePlugin({
      id: "clickhouse",
      name: "ClickHouse",
      description: "ClickHouse on this node. Create databases from Databases in the panel.",
      spec: {
        packageSets: [["clickhouse-server", "clickhouse-client"]],
        services: ["clickhouse-server"],
        prepare: prepareClickHouseRepo,
      },
      probe: engines.probeClickHouse,
      create: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.createClickHouseDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? params.dbName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      remove: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.deleteClickHouseDatabase({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
    })
  );
  register(
    dbEnginePlugin({
      id: "sqlite",
      name: "SQLite",
      description: "SQLite files on this node. Create databases from Databases in the panel.",
      spec: { packageSets: [["sqlite3"]] },
      probe: engines.probeSqlite,
      create: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.createSqliteDatabase({
          dbName: String(params.dbName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      remove: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.deleteSqliteDatabase({
          dbName: String(params.dbName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
    })
  );
  register(
    dbEnginePlugin({
      id: "elasticsearch",
      name: "Elasticsearch",
      description: "Elasticsearch on this node. Create indexes from Databases in the panel.",
      spec: {
        packageSets: [["elasticsearch"]],
        services: ["elasticsearch"],
      },
      probe: engines.probeElastic,
      create: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.createElasticIndex({
          dbName: String(params.dbName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
      remove: async (_op, params, ctx) => ({
        ok: true,
        installed: true,
        data: await engines.deleteElasticIndex({
          dbName: String(params.dbName ?? ""),
          dryRun: ctx.dryRun,
        }),
      }),
    })
  );
  register(
    dbEnginePlugin({
      id: "cockroachdb",
      name: "CockroachDB",
      description: "CockroachDB (PostgreSQL wire). Install the binary on the host, then create DBs from the panel.",
      spec: { packageSets: [["cockroachdb"], ["cockroach"]] },
      probe: async () => {
        const bin = await which("cockroach");
        return bin
          ? { ok: true, detail: bin }
          : { ok: false, detail: "cockroach binary not found" };
      },
      create: async () => ({
        ok: false,
        detail: "CockroachDB create is not wired. Use cockroach sql after install.",
      }),
      remove: async () => ({ ok: false, detail: "Not supported" }),
    })
  );
  register(
    dbEnginePlugin({
      id: "timescaledb",
      name: "TimescaleDB",
      description: "TimescaleDB extension on PostgreSQL. Install then create a Postgres database and enable the extension.",
      spec: {
        packageSets: [
          ["timescaledb-2-postgresql-16"],
          ["postgresql-16-timescaledb"],
          ["timescaledb-postgresql-16"],
        ],
        services: ["postgresql"],
      },
      probe: async () => {
        try {
          const dir = "/usr/share/postgresql";
          if (fsSync.existsSync(dir)) {
            for (const ver of fsSync.readdirSync(dir)) {
              const control = path.join(dir, ver, "extension", "timescaledb.control");
              if (fsSync.existsSync(control)) {
                return { ok: true, detail: control };
              }
            }
          }
          return { ok: false, detail: "TimescaleDB extension is not installed" };
        } catch (error) {
          return {
            ok: false,
            detail: error instanceof Error ? error.message : "TimescaleDB not found",
          };
        }
      },
      create: async (_op, params, ctx) => {
        const data = await createPostgresDatabaseOnServer({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? ""),
          password: String(params.password ?? ""),
          dryRun: ctx.dryRun,
        });
        return { ok: true, installed: true, data };
      },
      remove: async (_op, params, ctx) => {
        const data = await deletePostgresDatabaseOnServer({
          dbName: String(params.dbName ?? ""),
          roleName: String(params.roleName ?? ""),
          dryRun: ctx.dryRun,
        });
        return { ok: true, installed: true, data };
      },
    })
  );
  register(binaryRuntime("node", "Node.js", ["node"], "Node.js application runtime"));
  register(binaryRuntime("python", "Python", ["python3", "python"], "Python application runtime"));
  register(binaryRuntime("php", "PHP", ["php"], "PHP-FPM / CLI runtime"));
  register(binaryRuntime("go", "Go", ["go"], "Go application runtime"));
  register(binaryRuntime("bun", "Bun", ["bun"], "Bun application runtime"));
  register(binaryRuntime("deno", "Deno", ["deno"], "Deno application runtime"));
  register(binaryRuntime("java", "Java", ["java"], "JVM application runtime"));
  register(binaryRuntime("dotnet", ".NET", ["dotnet"], ".NET application runtime"));
  register(
    servicePlugin(
      "mail",
      "Mail server",
      "Virtual mailboxes (Postfix/Dovecot) on this node",
      async () => {
        const sendmail = await which("sendmail");
        return sendmail
          ? { ok: true, detail: sendmail }
          : { ok: false, detail: "sendmail/postfix not found" };
      },
      {
        packageSets: [["postfix", "dovecot-core", "dovecot-imapd"]],
        services: ["postfix", "dovecot"],
        script: "install-mail.sh",
      }
    )
  );
  register(
    servicePlugin(
      "dns",
      "DNS server",
      "BIND/named zone files on this node",
      async () => {
        const named = await which("named");
        const rndc = await which("rndc");
        return named || rndc
          ? { ok: true, detail: named || rndc || "dns tools present" }
          : { ok: false, detail: "named/rndc not found" };
      },
      {
        packageSets: [["bind9"]],
        services: ["named", "bind9"],
        script: "install-bind.sh",
      }
    )
  );
  register(
    servicePlugin(
      "ftp",
      "FTP/SFTP",
      "System FTP users for site roots",
      async () => {
        const vsftpd = await which("vsftpd");
        return vsftpd
          ? { ok: true, detail: vsftpd }
          : { ok: false, detail: "vsftpd not found" };
      },
      {
        packageSets: [["vsftpd"]],
        services: ["vsftpd"],
        script: "install-ftp.sh",
      }
    )
  );
  register(
    servicePlugin(
      "docker",
      "Docker",
      "Docker Engine / compose on this node",
      async () => {
        const docker = await which("docker");
        return docker
          ? { ok: true, detail: docker }
          : { ok: false, detail: "docker CLI not found" };
      },
      { packageSets: [["docker.io", "docker-compose-v2"], ["docker-ce"]], services: ["docker"] }
    )
  );
  register(
    servicePlugin(
      "minio",
      "MinIO",
      "MinIO object storage",
      async () => {
        const bin = await which("minio");
        return bin ? { ok: true, detail: bin } : { ok: false, detail: "minio not found" };
      },
      { packageSets: [["minio"]] }
    )
  );
  register(localBackupPlugin());
  await loadContrib();
}
