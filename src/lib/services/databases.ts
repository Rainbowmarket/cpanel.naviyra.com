import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId } from "@/lib/agent/target";
import { hashPassword } from "@/lib/auth";
import { resolveHostingTarget } from "@/lib/hosting-targets";

const RESERVED_PG_NAMES = new Set([
  "postgres",
  "template0",
  "template1",
  "template_postgres",
]);

export const PANEL_DB_ENGINES = [
  { id: "postgres", label: "PostgreSQL", port: 5432, scheme: "postgresql" },
  { id: "mysql", label: "MySQL", port: 3306, scheme: "mysql" },
  { id: "mariadb", label: "MariaDB", port: 3306, scheme: "mysql" },
  { id: "mongodb", label: "MongoDB", port: 27017, scheme: "mongodb" },
  { id: "redis", label: "Redis", port: 6379, scheme: "redis" },
  { id: "clickhouse", label: "ClickHouse", port: 9000, scheme: "clickhouse" },
  { id: "sqlite", label: "SQLite", port: 0, scheme: "sqlite" },
  { id: "elasticsearch", label: "Elasticsearch", port: 9200, scheme: "http" },
  { id: "timescaledb", label: "TimescaleDB", port: 5432, scheme: "postgresql" },
] as const;

export type PanelDbEngine = (typeof PANEL_DB_ENGINES)[number]["id"];

function engineMeta(engine: string) {
  return (
    PANEL_DB_ENGINES.find((e) => e.id === engine) ?? {
      id: engine,
      label: engine,
      port: 0,
      scheme: engine,
    }
  );
}

function isPostgresWire(engine: string) {
  return engine === "postgres" || engine === "timescaledb";
}

/** Any managed database can open native Browse; the agent/plugin supplies schema + rows. */
export function canBrowseEngine(engine: string) {
  return Boolean(engine);
}

function sanitizePgLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63);
  if (!cleaned || !/^[a-z]/.test(cleaned)) {
    throw new Error(
      "Database name must start with a letter and use letters, digits, or _"
    );
  }
  if (RESERVED_PG_NAMES.has(cleaned) || cleaned.startsWith("pg_")) {
    throw new Error(`'${cleaned}' is reserved. Choose another database name.`);
  }
  return cleaned;
}

/** Exact PostgreSQL name — no domain hash or n_ prefix. */
function buildPgNames(label: string) {
  const safe = sanitizePgLabel(label);
  return { label: safe, dbName: safe, roleName: safe };
}

export function postgresConnectionInfo() {
  // Localhost-only by default; remote listen is out of scope.
  // Port may be 5433 when 5432 is already used (e.g. Docker).
  const portRaw = process.env.CUSTOMER_POSTGRES_PORT?.trim();
  const port = portRaw && /^\d+$/.test(portRaw) ? Number(portRaw) : 5432;
  return {
    host: process.env.CUSTOMER_POSTGRES_HOST?.trim() || "127.0.0.1",
    port,
  };
}

export function buildConnectionUri(input: {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  engine?: string;
}) {
  const engine = input.engine || "postgres";
  const user = encodeURIComponent(input.user);
  const db = encodeURIComponent(input.database);
  const pass =
    input.password !== undefined ? encodeURIComponent(input.password) : "";
  const auth =
    input.password !== undefined ? `${user}:${pass}` : user;
  if (engine === "sqlite") {
    return `sqlite:${input.database}`;
  }
  if (engine === "elasticsearch") {
    return `http://${input.host}:${input.port}/${db}`;
  }
  if (engine === "redis") {
    return input.password !== undefined
      ? `redis://${auth}@${input.host}:${input.port}/0`
      : `redis://${input.host}:${input.port}/0`;
  }
  if (engine === "mongodb") {
    return input.password !== undefined
      ? `mongodb://${auth}@${input.host}:${input.port}/${db}`
      : `mongodb://${user}@${input.host}:${input.port}/${db}`;
  }
  if (engine === "mysql" || engine === "mariadb") {
    return input.password !== undefined
      ? `mysql://${auth}@${input.host}:${input.port}/${db}`
      : `mysql://${user}@${input.host}:${input.port}/${db}`;
  }
  if (engine === "clickhouse") {
    return `clickhouse://${auth}@${input.host}:${input.port}/${db}`;
  }
  const scheme = engineMeta(engine).scheme || engine || "postgresql";
  if (input.password !== undefined) {
    return `${scheme}://${auth}@${input.host}:${input.port}/${db}`;
  }
  return `${scheme}://${user}@${input.host}:${input.port}/${db}`;
}

export function connectionForEngine(
  engine: string,
  db: { dbName: string; roleName: string },
  password?: string
) {
  const meta = engineMeta(engine);
  const base = postgresConnectionInfo();
  const host = base.host;
  const port = meta.port || base.port;
  return {
    engine,
    host,
    port,
    database: db.dbName,
    user: db.roleName,
    ...(password !== undefined ? { password } : {}),
    uri: buildConnectionUri({
      host,
      port,
      database: db.dbName,
      user: db.roleName,
      password,
      engine,
    }),
  };
}

export async function listInstalledDbEngines(userId: string, role?: string) {
  const domains = await prisma.domain.findMany({
    where: role === "ADMIN" ? undefined : { userId },
    select: { serverId: true },
  });
  const serverIds = [...new Set(domains.map((d) => d.serverId))];
  if (serverIds.length === 0) {
    return [{ id: "postgres", label: "PostgreSQL", serverId: "" }];
  }
  const rows = await prisma.serverPlugin.findMany({
    where: {
      serverId: { in: serverIds },
      kind: "database",
      installed: true,
    },
    select: { pluginId: true, name: true, serverId: true },
  });
  const out: { id: string; label: string; serverId: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const meta = engineMeta(row.pluginId);
    const label = PANEL_DB_ENGINES.some((e) => e.id === row.pluginId)
      ? meta.label
      : row.name || meta.label;
    const key = `${row.serverId}:${row.pluginId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: row.pluginId, label, serverId: row.serverId });
  }
  for (const serverId of serverIds) {
    if (!out.some((e) => e.serverId === serverId && e.id === "postgres")) {
      out.unshift({ id: "postgres", label: "PostgreSQL", serverId });
    }
  }
  return out;
}

export async function listPostgresDatabases(userId: string, role?: string) {
  return prisma.postgresDatabase.findMany({
    where: role === "ADMIN" ? undefined : { domain: { userId } },
    orderBy: { createdAt: "desc" },
    include: {
      domain: { select: { id: true, name: true } },
    },
  });
}

export async function createPostgresDatabase(input: {
  target: string;
  userId: string;
  role?: "ADMIN" | "USER";
  label: string;
  password: string;
  engine?: string;
}) {
  if (!input.password || input.password.length < 8) {
    throw new Error("Database password must be at least 8 characters");
  }

  const engine = (input.engine || "postgres").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(engine)) {
    throw new Error("Unknown database engine");
  }

  const actor = { id: input.userId, role: input.role ?? ("USER" as const) };
  const hostingTarget = await resolveHostingTarget(input.target, actor, {
    excludeMailSubdomains: true,
  });

  const domain = await prisma.domain.findFirstOrThrow({
    where: {
      id: hostingTarget.domainId,
      ...(actor.role === "ADMIN" ? {} : { userId: input.userId }),
    },
    include: { server: true },
  });

  const names = buildPgNames(input.label);
  const existing = await prisma.postgresDatabase.findFirst({
    where: {
      engine,
      OR: [
        { dbName: names.dbName },
        { roleName: names.roleName },
        { label: names.label },
      ],
    },
  });
  if (existing) {
    throw new Error(
      `Database '${names.dbName}' already exists in the panel. Choose another name.`
    );
  }

  const target = await agentTargetForServerId(domain.serverId);

  if (engine === "postgres") {
    const existsOnServer = await callAgent<{ exists?: boolean }>(
      { action: "postgres_database_exists", dbName: names.dbName },
      target
    );
    if (!existsOnServer.success) {
      throw new Error(
        existsOnServer.error ?? "Could not check whether the database already exists"
      );
    }
    if (existsOnServer.data?.exists) {
      throw new Error(
        `Database '${names.dbName}' already exists on the server. Choose another name.`
      );
    }

    const agentResult = await callAgent(
      {
        action: "create_postgres_database",
        dbName: names.dbName,
        roleName: names.roleName,
        password: input.password,
      },
      target
    );
    if (!agentResult.success) {
      throw new Error(
        agentResult.error ?? "Failed to provision PostgreSQL database on server"
      );
    }
  } else {
    const plugin = await prisma.serverPlugin.findFirst({
      where: { serverId: domain.serverId, pluginId: engine, installed: true },
    });
    if (!plugin && engine !== "timescaledb" && engine !== "postgres") {
      throw new Error(
        `Install ${engineMeta(engine).label} first: Servers → Plugins → Install`
      );
    }
    const invoked = await callAgent<{ ok?: boolean; detail?: string }>(
      {
        action: "plugin_invoke",
        pluginId: engine,
        op: "create",
        params: {
          dbName: names.dbName,
          roleName: names.roleName,
          password: input.password,
        },
      },
      target
    );
    if (!invoked.success) {
      throw new Error(invoked.error ?? "Failed to create database on the agent");
    }
    if (invoked.data && invoked.data.ok === false) {
      throw new Error(invoked.data.detail ?? "Create failed on the agent");
    }
  }

  const passwordHash = await hashPassword(input.password);

  const record = await prisma.postgresDatabase.create({
    data: {
      label: names.label,
      engine,
      dbName: names.dbName,
      roleName: names.roleName,
      passwordHash,
      domainId: domain.id,
    },
    include: {
      domain: { select: { id: true, name: true } },
    },
  });

  return {
    database: record,
    connection: connectionForEngine(engine, record, input.password),
  };
}

export async function resetPostgresDatabasePassword(input: {
  id: string;
  userId: string;
  role?: string;
  password: string;
}) {
  if (!input.password || input.password.length < 8) {
    throw new Error("Database password must be at least 8 characters");
  }

  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: { domain: { include: { server: true } } },
  });

  const target = await agentTargetForServerId(record.domain.serverId);
  if (isPostgresWire(record.engine)) {
    const agentResult = await callAgent(
      {
        action: "reset_postgres_password",
        roleName: record.roleName,
        password: input.password,
      },
      target
    );
    if (!agentResult.success) {
      throw new Error(
        agentResult.error ?? "Failed to reset password on server"
      );
    }
  } else {
    const invoked = await callAgent<{ ok?: boolean; detail?: string }>(
      {
        action: "plugin_invoke",
        pluginId: record.engine,
        op: "configure",
        params: {
          action: "reset_password",
          roleName: record.roleName,
          password: input.password,
        },
      },
      target
    );
    if (!invoked.success) {
      throw new Error(invoked.error ?? "Failed to reset password on the agent");
    }
    if (invoked.data && invoked.data.ok === false) {
      throw new Error(invoked.data.detail ?? "Password reset is not supported for this engine");
    }
  }

  const passwordHash = await hashPassword(input.password);
  const updated = await prisma.postgresDatabase.update({
    where: { id: record.id },
    data: { passwordHash },
    include: {
      domain: { select: { id: true, name: true } },
    },
  });

  return {
    database: updated,
    connection: connectionForEngine(updated.engine, updated, input.password),
  };
}

export async function deletePostgresDatabase(
  id: string,
  userId: string,
  role?: string
) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id,
      ...(role === "ADMIN" ? {} : { domain: { userId } }),
    },
    include: { domain: { include: { server: true } } },
  });

  const target = await agentTargetForServerId(record.domain.serverId);
  if (isPostgresWire(record.engine)) {
    const agentResult = await callAgent(
      {
        action: "delete_postgres_database",
        dbName: record.dbName,
        roleName: record.roleName,
      },
      target
    );
    if (!agentResult.success) {
      throw new Error(
        agentResult.error ?? "Failed to remove database on server"
      );
    }
  } else {
    const invoked = await callAgent<{ ok?: boolean; detail?: string }>(
      {
        action: "plugin_invoke",
        pluginId: record.engine,
        op: "delete",
        params: { dbName: record.dbName, roleName: record.roleName },
      },
      target
    );
    if (!invoked.success) {
      throw new Error(invoked.error ?? "Failed to delete database on the agent");
    }
    if (invoked.data && invoked.data.ok === false) {
      throw new Error(invoked.data.detail ?? "Delete failed on the agent");
    }
  }

  return prisma.postgresDatabase.delete({ where: { id: record.id } });
}

export async function inspectPostgresDatabaseSchema(
  id: string,
  userId: string,
  role?: string
) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id,
      ...(role === "ADMIN" ? {} : { domain: { userId } }),
    },
    include: {
      domain: {
        select: {
          id: true,
          name: true,
          serverId: true,
          server: { select: { id: true } },
        },
      },
    },
  });
  if (!canBrowseEngine(record.engine || "postgres")) {
    throw new Error(
      "This engine cannot be browsed in the panel. Copy the URI and use it from your app."
    );
  }

  const engine = record.engine || "postgres";
  const agentResult = isPostgresWire(engine)
    ? await callAgent(
        {
          action: "inspect_postgres_schema",
          dbName: record.dbName,
        },
        await agentTargetForServerId(record.domain.serverId)
      )
    : await callAgent(
        {
          action: "inspect_hosted_database",
          engine,
          dbName: record.dbName,
        },
        await agentTargetForServerId(record.domain.serverId)
      );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to inspect database schema on server"
    );
  }

  const data = (agentResult.data ?? {}) as {
    tables?: unknown[];
    dbSizeBytes?: number | null;
    dbSizePretty?: string | null;
    pgVersion?: string | null;
    indexes?: unknown[];
    relations?: unknown[];
    functions?: unknown[];
    triggers?: unknown[];
    enums?: unknown[];
  };

  return {
    database: {
      id: record.id,
      label: record.label,
      dbName: record.dbName,
      roleName: record.roleName,
      engine,
      domain: { id: record.domain.id, name: record.domain.name },
    },
    tables: data.tables ?? [],
    dbSizeBytes: data.dbSizeBytes ?? null,
    dbSizePretty: data.dbSizePretty ?? null,
    pgVersion: data.pgVersion ?? null,
    indexes: data.indexes ?? [],
    relations: data.relations ?? [],
    functions: data.functions ?? [],
    triggers: data.triggers ?? [],
    enums: data.enums ?? [],
  };
}

export async function previewPostgresDatabaseTable(input: {
  id: string;
  userId: string;
  role?: string;
  schema?: string;
  table: string;
  limit?: number;
  search?: string;
  filterColumn?: string;
  filterOp?: "contains" | "equals";
  filterValue?: string;
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          serverId: true,
          server: { select: { id: true } },
        },
      },
    },
  });

  const engine = record.engine || "postgres";
  const agentResult = isPostgresWire(engine)
    ? await callAgent(
        {
          action: "preview_postgres_table",
          dbName: record.dbName,
          schema: input.schema || "public",
          table: input.table,
          limit: input.limit,
          search: input.search,
          filterColumn: input.filterColumn,
          filterOp: input.filterOp,
          filterValue: input.filterValue,
        },
        await agentTargetForServerId(record.domain.serverId)
      )
    : await callAgent(
        {
          action: "preview_hosted_table",
          engine,
          dbName: record.dbName,
          table: input.table,
          limit: input.limit,
        },
        await agentTargetForServerId(record.domain.serverId)
      );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to preview PostgreSQL table on server"
    );
  }

  return agentResult.data as {
    dbName: string;
    schema: string;
    table: string;
    columns: string[];
    rows: Record<string, unknown>[];
    limit: number;
  };
}

export async function queryPostgresDatabaseSql(input: {
  id: string;
  userId: string;
  role?: string;
  sql: string;
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          serverId: true,
          server: { select: { id: true } },
        },
      },
    },
  });

  const engine = record.engine || "postgres";
  if (engine === "redis" || engine === "mongodb" || engine === "elasticsearch") {
    throw new Error("SQL is not available for this engine. Open Browse and use the Data tab.");
  }
  const agentResult = isPostgresWire(engine)
    ? await callAgent(
        {
          action: "query_postgres_sql",
          dbName: record.dbName,
          sql: input.sql,
        },
        await agentTargetForServerId(record.domain.serverId)
      )
    : await callAgent(
        {
          action: "query_hosted_sql",
          engine,
          dbName: record.dbName,
          sql: input.sql,
        },
        await agentTargetForServerId(record.domain.serverId)
      );
  if (!agentResult.success) {
    throw new Error(agentResult.error ?? "Failed to run SQL on server");
  }
  return agentResult.data as {
    command: string;
    columns: string[];
    rows: Record<string, unknown>[];
  };
}

export async function createPostgresDatabaseTable(input: {
  id: string;
  userId: string;
  role?: string;
  schema?: string;
  table: string;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    primaryKey?: boolean;
    defaultValue?: string | null;
  }>;
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          serverId: true,
          server: { select: { id: true } },
        },
      },
    },
  });

  const agentResult = await callAgent(
    {
      action: "create_postgres_table",
      dbName: record.dbName,
      roleName: record.roleName,
      schema: input.schema || "public",
      table: input.table,
      columns: input.columns,
    },
    await agentTargetForServerId(record.domain.serverId)
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to create PostgreSQL table on server"
    );
  }

  return agentResult.data as {
    dbName: string;
    schema: string;
    table: string;
    columns: number;
  };
}

export async function deletePostgresDatabaseTable(input: {
  id: string;
  userId: string;
  role?: string;
  schema?: string;
  table: string;
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          serverId: true,
          server: { select: { id: true } },
        },
      },
    },
  });

  const agentResult = await callAgent(
    {
      action: "delete_postgres_table",
      dbName: record.dbName,
      schema: input.schema || "public",
      table: input.table,
    },
    await agentTargetForServerId(record.domain.serverId)
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to delete PostgreSQL table on server"
    );
  }

  return agentResult.data as {
    dbName: string;
    schema: string;
    table: string;
  };
}

export async function alterPostgresDatabaseTable(input: {
  id: string;
  userId: string;
  role?: string;
  schema?: string;
  table: string;
  newName?: string;
  addColumns?: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    primaryKey?: boolean;
    defaultValue?: string | null;
  }>;
  dropColumns?: string[];
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          serverId: true,
          server: { select: { id: true } },
        },
      },
    },
  });

  const agentResult = await callAgent(
    {
      action: "alter_postgres_table",
      dbName: record.dbName,
      roleName: record.roleName,
      schema: input.schema || "public",
      table: input.table,
      newName: input.newName,
      addColumns: input.addColumns,
      dropColumns: input.dropColumns,
    },
    await agentTargetForServerId(record.domain.serverId)
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to alter PostgreSQL table on server"
    );
  }

  return agentResult.data as {
    dbName: string;
    schema: string;
    table: string;
    added: number;
    dropped: number;
    renamed: boolean;
  };
}

export async function mutatePostgresDatabaseRows(input: {
  id: string;
  userId: string;
  role?: string;
  schema?: string;
  table: string;
  op: "insert" | "update" | "delete";
  values?: Record<string, unknown>;
  where?: Record<string, unknown>;
  whereList?: Record<string, unknown>[];
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          serverId: true,
          server: { select: { id: true } },
        },
      },
    },
  });

  const agentResult = await callAgent(
    {
      action: "mutate_postgres_table_rows",
      dbName: record.dbName,
      schema: input.schema || "public",
      table: input.table,
      op: input.op,
      values: input.values,
      where: input.where,
      whereList: input.whereList,
    },
    await agentTargetForServerId(record.domain.serverId)
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to change PostgreSQL table rows on server"
    );
  }

  return agentResult.data as {
    dbName: string;
    schema: string;
    table: string;
    op: string;
  };
}

export async function exportPostgresDatabaseDump(input: {
  id: string;
  userId: string;
  role?: string;
  format?: "sql" | "custom";
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: { domain: { include: { server: true } } },
  });

  const agentResult = await callAgent<{
    fileName?: string;
    contentBase64?: string;
    bytes?: number;
    format?: string;
  }>(
    {
      action: "export_postgres_database",
      dbName: record.dbName,
      format: input.format === "custom" ? "custom" : "sql",
    },
    await agentTargetForServerId(record.domain.serverId)
  );
  if (!agentResult.success || !agentResult.data?.contentBase64) {
    throw new Error(
      agentResult.error ?? "Failed to export PostgreSQL database"
    );
  }

  return {
    dbName: record.dbName,
    fileName: agentResult.data.fileName || `${record.dbName}.sql`,
    contentBase64: agentResult.data.contentBase64,
    bytes: agentResult.data.bytes ?? 0,
  };
}

export async function importPostgresDatabaseDump(input: {
  id: string;
  userId: string;
  role?: string;
  fileName: string;
  content: Buffer;
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: { domain: { include: { server: true } } },
  });

  const { getMaxUploadMb } = await import("@/lib/services/panel-settings");
  const maxMb = await getMaxUploadMb();
  const maxBytes = maxMb * 1024 * 1024;
  if (input.content.length > maxBytes) {
    throw new Error(
      `Import is larger than the ${maxMb} MB upload limit. An admin can raise this under Settings.`
    );
  }

  const agentResult = await callAgent(
    {
      action: "import_postgres_database",
      dbName: record.dbName,
      roleName: record.roleName,
      fileName: input.fileName,
      contentBase64: input.content.toString("base64"),
    },
    await agentTargetForServerId(record.domain.serverId)
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to import PostgreSQL dump"
    );
  }
  return { dbName: record.dbName };
}

export function formatPostgresClientError(raw: string): {
  error: string;
  detail: string;
} {
  const detail = raw.trim();
  const errorLine =
    detail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /\bERROR:/i.test(line)) || detail;
  const short = errorLine.replace(/^.*\bERROR:\s*/i, "").trim();

  if (/already exists/i.test(short)) {
    return {
      error:
        "An object in this dump already exists. Import now drops and replaces the public schema, then loads the file again so existing names (including IDs) are overwritten.",
      detail,
    };
  }
  if (/must be owner/i.test(short)) {
    return {
      error:
        "The database login role does not own this object. Use Fix ownership, then restart the app.",
      detail,
    };
  }
  if (/permission denied|insufficient privilege/i.test(short)) {
    return {
      error:
        "PostgreSQL denied this statement. Check the database user in the app .env matches this database role.",
      detail,
    };
  }
  return {
    error: short || "PostgreSQL rejected the dump.",
    detail,
  };
}

export async function reassignPostgresDatabaseOwnership(input: {
  id: string;
  userId: string;
  role?: string;
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: { domain: { include: { server: true } } },
  });

  const agentResult = await callAgent(
    {
      action: "reassign_postgres_ownership",
      dbName: record.dbName,
      roleName: record.roleName,
    },
    await agentTargetForServerId(record.domain.serverId)
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to make the database role owner of public tables"
    );
  }
  return { dbName: record.dbName, roleName: record.roleName };
}
