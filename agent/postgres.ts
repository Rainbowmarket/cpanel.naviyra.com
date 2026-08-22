/**
 * Customer PostgreSQL databases (Linux).
 * Creates roles + databases via psql as the postgres OS user.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_ROOT } from "./paths";
import {
  execAsPostgres,
  ensurePostgresReady,
  PG_DUMP_TIMEOUT_MS,
  psqlExec,
  psqlQuery,
} from "./pg-bin";

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid PostgreSQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sanitizePgLabel(raw: string): string {
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
  if (
    cleaned === "postgres" ||
    cleaned === "template0" ||
    cleaned === "template1" ||
    cleaned.startsWith("pg_")
  ) {
    throw new Error(`'${cleaned}' is reserved. Choose another database name.`);
  }
  return cleaned;
}

export function buildPgNames(_domainName: string, label: string): {
  label: string;
  dbName: string;
  roleName: string;
} {
  const safe = sanitizePgLabel(label);
  return { label: safe, dbName: safe, roleName: safe };
}

async function appendMap(line: string) {
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
  await fs.appendFile(path.join(CONFIG_ROOT, "postgres.map"), `${line}\n`, "utf8");
}

async function runPsql(sql: string, dryRun: boolean, database?: string) {
  if (dryRun) return;
  if (process.platform === "win32") {
    throw new Error("PostgreSQL provisioning requires Linux");
  }
  await psqlExec(sql, database);
}

async function databaseExists(dbName: string): Promise<boolean> {
  const { stdout } = await psqlQuery(
    `SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(dbName)}`
  );
  return stdout.trim() === "1";
}

export async function postgresDatabaseExistsOnServer(input: {
  dbName: string;
  dryRun: boolean;
}): Promise<{ dbName: string; exists: boolean; dryRun: boolean }> {
  if (process.platform === "win32" || input.dryRun) {
    return { dbName: input.dbName, exists: false, dryRun: true };
  }
  return {
    dbName: input.dbName,
    exists: await databaseExists(input.dbName),
    dryRun: false,
  };
}

export async function createPostgresDatabaseOnServer(input: {
  dbName: string;
  roleName: string;
  password: string;
  dryRun: boolean;
}) {
  const db = quoteIdent(input.dbName);
  const role = quoteIdent(input.roleName);
  const password = quoteLiteral(input.password);

  await appendMap(`create ${input.dbName}:${input.roleName}`);

  if (process.platform === "win32" || input.dryRun) {
    return {
      dbName: input.dbName,
      roleName: input.roleName,
      dryRun: true as const,
    };
  }

  if (await databaseExists(input.dbName)) {
    throw new Error(
      `Database '${input.dbName}' already exists on the server. Choose another name.`
    );
  }

  await runPsql(
    `DO $$ BEGIN
       CREATE ROLE ${role} LOGIN PASSWORD ${password};
     EXCEPTION WHEN duplicate_object THEN
       ALTER ROLE ${role} WITH LOGIN PASSWORD ${password};
     END $$;`,
    false
  );

  await runPsql(
    `CREATE DATABASE ${db} OWNER ${role} ENCODING 'UTF8' TEMPLATE template0;`,
    false
  );

  await runPsql(`GRANT ALL PRIVILEGES ON DATABASE ${db} TO ${role};`, false);
  await runPsql(
    `GRANT ALL ON SCHEMA public TO ${role}; ALTER SCHEMA public OWNER TO ${role};`,
    false,
    input.dbName
  );

  return {
    dbName: input.dbName,
    roleName: input.roleName,
    dryRun: false as const,
  };
}

export async function resetPostgresPasswordOnServer(input: {
  roleName: string;
  password: string;
  dryRun: boolean;
}) {
  const role = quoteIdent(input.roleName);
  const password = quoteLiteral(input.password);
  await appendMap(`reset ${input.roleName}`);
  await runPsql(`ALTER ROLE ${role} WITH PASSWORD ${password};`, input.dryRun);
  return { roleName: input.roleName, dryRun: input.dryRun };
}

export async function deletePostgresDatabaseOnServer(input: {
  dbName: string;
  roleName: string;
  dryRun: boolean;
}) {
  const db = quoteIdent(input.dbName);
  const role = quoteIdent(input.roleName);
  await appendMap(`delete ${input.dbName}:${input.roleName}`);

  if (process.platform === "win32" || input.dryRun) {
    return { dbName: input.dbName, roleName: input.roleName, dryRun: true as const };
  }

  await runPsql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(input.dbName)} AND pid <> pg_backend_pid();`,
    false
  ).catch(() => undefined);
  await runPsql(`DROP DATABASE IF EXISTS ${db};`, false);
  await runPsql(`DROP ROLE IF EXISTS ${role};`, false);

  return { dbName: input.dbName, roleName: input.roleName, dryRun: false as const };
}

async function psqlJsonQuery(database: string, sql: string): Promise<unknown> {
  if (process.platform === "win32") {
    throw new Error("PostgreSQL inspection requires Linux");
  }
  const { stdout } = await psqlQuery(sql, database);
  const text = stdout.trim();
  if (!text || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Failed to parse PostgreSQL JSON response");
  }
}

export type PostgresColumnInfo = {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  defaultValue: string | null;
  ordinal: number;
  isPrimaryKey: boolean;
};

export type PostgresTableInfo = {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view" | "other";
  approxRows: number | null;
  sizeBytes: number | null;
  sizePretty: string | null;
  indexCount: number;
  lastUpdated: string | null;
  columns: PostgresColumnInfo[];
};

export type PostgresIndexInfo = {
  schema: string;
  table: string;
  name: string;
  unique: boolean;
  definition: string;
};

export type PostgresRelationInfo = {
  schema: string;
  table: string;
  column: string;
  foreignSchema: string;
  foreignTable: string;
  foreignColumn: string;
  name: string;
};

export type PostgresFunctionInfo = {
  schema: string;
  name: string;
  args: string;
  returns: string;
  language: string;
};

export type PostgresTriggerInfo = {
  schema: string;
  table: string;
  name: string;
  timing: string;
  event: string;
  statement: string;
};

export type PostgresEnumInfo = {
  schema: string;
  name: string;
  labels: string[];
};

export type PostgresSchemaInspect = {
  dbName: string;
  dbSizeBytes: number | null;
  dbSizePretty: string | null;
  pgVersion: string | null;
  tables: PostgresTableInfo[];
  indexes: PostgresIndexInfo[];
  relations: PostgresRelationInfo[];
  functions: PostgresFunctionInfo[];
  triggers: PostgresTriggerInfo[];
  enums: PostgresEnumInfo[];
  dryRun: boolean;
};

function mapRelKind(kind: string): PostgresTableInfo["kind"] {
  switch (kind) {
    case "r":
    case "p":
      return "table";
    case "v":
      return "view";
    case "m":
      return "materialized_view";
    default:
      return "other";
  }
}

function emptySchemaInspect(dbName: string, dryRun: boolean): PostgresSchemaInspect {
  return {
    dbName,
    dbSizeBytes: null,
    dbSizePretty: null,
    pgVersion: null,
    tables: [],
    indexes: [],
    relations: [],
    functions: [],
    triggers: [],
    enums: [],
    dryRun,
  };
}

export async function inspectPostgresSchemaOnServer(input: {
  dbName: string;
  dryRun: boolean;
}): Promise<PostgresSchemaInspect> {
  const dbName = input.dbName.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid PostgreSQL database name: ${input.dbName}`);
  }

  if (process.platform === "win32" || input.dryRun) {
    return emptySchemaInspect(dbName, true);
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  const sizeSql = `SELECT json_build_object(
    'sizeBytes', pg_database_size(current_database()),
    'sizePretty', pg_size_pretty(pg_database_size(current_database())),
    'pgVersion', current_setting('server_version')
  )`;

  const tablesSql = `
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.schema_name, t.table_name), '[]'::json)
FROM (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relkind::text AS relkind,
    COALESCE(s.n_live_tup, 0)::bigint AS approx_rows,
    CASE WHEN c.relkind IN ('r', 'p', 'm') THEN pg_total_relation_size(c.oid) ELSE NULL END AS size_bytes,
    CASE WHEN c.relkind IN ('r', 'p', 'm') THEN pg_size_pretty(pg_total_relation_size(c.oid)) ELSE NULL END AS size_pretty,
    (SELECT count(*)::int FROM pg_index ix WHERE ix.indrelid = c.oid) AS index_count,
    GREATEST(s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze) AS last_updated
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND c.relkind IN ('r', 'p', 'v', 'm')
  ORDER BY n.nspname, c.relname
) t`;

  const columnsSql = `
SELECT COALESCE(json_agg(row_to_json(c) ORDER BY c.table_schema, c.table_name, c.ordinal_position), '[]'::json)
FROM (
  SELECT
    cols.table_schema,
    cols.table_name,
    cols.column_name,
    cols.data_type,
    cols.udt_name,
    cols.is_nullable,
    cols.column_default,
    cols.ordinal_position,
    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
  FROM information_schema.columns cols
  LEFT JOIN (
    SELECT kcu.table_schema, kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
     AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
  ) pk
    ON pk.table_schema = cols.table_schema
   AND pk.table_name = cols.table_name
   AND pk.column_name = cols.column_name
  WHERE cols.table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position
) c`;

  const rawTables = (await psqlJsonQuery(dbName, tablesSql)) as Array<{
    schema_name: string;
    table_name: string;
    relkind: string;
    approx_rows: number | string | null;
    size_bytes: number | string | null;
    size_pretty: string | null;
    index_count: number | string | null;
    last_updated: string | null;
  }> | null;

  const rawColumns = (await psqlJsonQuery(dbName, columnsSql)) as Array<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    ordinal_position: number;
    is_primary_key: boolean;
  }> | null;

  const columnsByTable = new Map<string, PostgresColumnInfo[]>();
  for (const col of rawColumns ?? []) {
    const key = `${col.table_schema}.${col.table_name}`;
    const list = columnsByTable.get(key) ?? [];
    list.push({
      name: col.column_name,
      dataType: col.data_type,
      udtName: col.udt_name,
      nullable: col.is_nullable === "YES",
      defaultValue: col.column_default,
      ordinal: Number(col.ordinal_position),
      isPrimaryKey: Boolean(col.is_primary_key),
    });
    columnsByTable.set(key, list);
  }

  const tables: PostgresTableInfo[] = (rawTables ?? []).map((t) => {
    const key = `${t.schema_name}.${t.table_name}`;
    const approx =
      t.approx_rows == null || t.approx_rows === ""
        ? null
        : Number(t.approx_rows);
    const sizeBytes =
      t.size_bytes == null || t.size_bytes === ""
        ? null
        : Number(t.size_bytes);
    return {
      schema: t.schema_name,
      name: t.table_name,
      kind: mapRelKind(t.relkind),
      approxRows: Number.isFinite(approx as number) ? (approx as number) : null,
      sizeBytes: Number.isFinite(sizeBytes as number) ? (sizeBytes as number) : null,
      sizePretty: t.size_pretty || null,
      indexCount: Number(t.index_count ?? 0) || 0,
      lastUpdated: t.last_updated ? String(t.last_updated) : null,
      columns: columnsByTable.get(key) ?? [],
    };
  });

  let dbSizeBytes: number | null = null;
  let dbSizePretty: string | null = null;
  let pgVersion: string | null = null;
  try {
    const sizeRaw = (await psqlJsonQuery(dbName, sizeSql)) as {
      sizeBytes?: number | string;
      sizePretty?: string;
      pgVersion?: string;
    } | null;
    if (sizeRaw?.sizeBytes != null) {
      const n = Number(sizeRaw.sizeBytes);
      dbSizeBytes = Number.isFinite(n) ? n : null;
    }
    dbSizePretty = sizeRaw?.sizePretty ?? null;
    pgVersion = sizeRaw?.pgVersion ? String(sizeRaw.pgVersion) : null;
  } catch {
    /* optional */
  }

  async function extra<T>(sql: string): Promise<T[]> {
    try {
      const raw = await psqlJsonQuery(dbName, sql);
      return Array.isArray(raw) ? (raw as T[]) : [];
    } catch {
      return [];
    }
  }

  const rawIndexes = await extra<{
    schema_name: string;
    table_name: string;
    index_name: string;
    is_unique: boolean;
    definition: string;
  }>(`
SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.schema_name, x.table_name, x.index_name), '[]'::json)
FROM (
  SELECT n.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
    ix.indisunique AS is_unique, pg_get_indexdef(i.oid) AS definition
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
) x`);

  const rawRelations = await extra<{
    table_schema: string;
    table_name: string;
    column_name: string;
    foreign_schema: string;
    foreign_table: string;
    foreign_column: string;
    constraint_name: string;
  }>(`
SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json)
FROM (
  SELECT
    tc.table_schema, tc.table_name, kcu.column_name,
    ccu.table_schema AS foreign_schema, ccu.table_name AS foreign_table,
    ccu.column_name AS foreign_column, tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
) x`);

  const rawFunctions = await extra<{
    schema_name: string;
    name: string;
    args: string;
    returns: string;
    language: string;
  }>(`
SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.schema_name, x.name), '[]'::json)
FROM (
  SELECT n.nspname AS schema_name, p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_function_result(p.oid) AS returns,
    l.lanname AS language
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND p.prokind IN ('f', 'p')
) x`);

  const rawTriggers = await extra<{
    event_object_schema: string;
    event_object_table: string;
    trigger_name: string;
    action_timing: string;
    event_manipulation: string;
    action_statement: string;
  }>(`
SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json)
FROM (
  SELECT event_object_schema, event_object_table, trigger_name,
    action_timing, event_manipulation, action_statement
  FROM information_schema.triggers
  WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
) x`);

  const rawEnums = await extra<{
    schema_name: string;
    name: string;
    labels: string[] | null;
  }>(`
SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.schema_name, x.name), '[]'::json)
FROM (
  SELECT n.nspname AS schema_name, t.typname AS name,
    (SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) AS labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typtype = 'e'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
) x`);

  return {
    dbName,
    dbSizeBytes,
    dbSizePretty,
    pgVersion,
    tables,
    indexes: rawIndexes.map((i) => ({
      schema: i.schema_name,
      table: i.table_name,
      name: i.index_name,
      unique: Boolean(i.is_unique),
      definition: i.definition || "",
    })),
    relations: rawRelations.map((r) => ({
      schema: r.table_schema,
      table: r.table_name,
      column: r.column_name,
      foreignSchema: r.foreign_schema,
      foreignTable: r.foreign_table,
      foreignColumn: r.foreign_column,
      name: r.constraint_name,
    })),
    functions: rawFunctions.map((f) => ({
      schema: f.schema_name,
      name: f.name,
      args: f.args || "",
      returns: f.returns || "",
      language: f.language || "",
    })),
    triggers: rawTriggers.map((t) => ({
      schema: t.event_object_schema,
      table: t.event_object_table,
      name: t.trigger_name,
      timing: t.action_timing || "",
      event: t.event_manipulation || "",
      statement: t.action_statement || "",
    })),
    enums: rawEnums.map((e) => ({
      schema: e.schema_name,
      name: e.name,
      labels: Array.isArray(e.labels) ? e.labels.map(String) : [],
    })),
    dryRun: false,
  };
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function listTableColumnNames(
  dbName: string,
  schema: string,
  table: string
): Promise<string[]> {
  const colsSql = `
SELECT COALESCE(json_agg(column_name ORDER BY ordinal_position), '[]'::json)
FROM information_schema.columns
WHERE table_schema = ${quoteLiteral(schema)}
  AND table_name = ${quoteLiteral(table)}`;
  const names = (await psqlJsonQuery(dbName, colsSql)) as string[] | null;
  return Array.isArray(names)
    ? names.filter((n) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(n)))
    : [];
}

function buildPreviewWhere(opts: {
  columns: string[];
  search?: string;
  filterColumn?: string;
  filterOp?: string;
  filterValue?: string;
}): string {
  const parts: string[] = [];
  const search = (opts.search || "").trim().slice(0, 120);
  if (search && opts.columns.length > 0) {
    const lit = quoteLiteral(`%${escapeLike(search)}%`);
    parts.push(
      `(${opts.columns
        .map((c) => `${quoteIdent(c)}::text ILIKE ${lit} ESCAPE '\\'`)
        .join(" OR ")})`
    );
  }
  const col = (opts.filterColumn || "").trim();
  const val = (opts.filterValue || "").trim().slice(0, 200);
  if (col && val) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col) || !opts.columns.includes(col)) {
      throw new Error("Invalid filter column");
    }
    if (opts.filterOp === "equals") {
      parts.push(`${quoteIdent(col)}::text = ${quoteLiteral(val)}`);
    } else {
      parts.push(
        `${quoteIdent(col)}::text ILIKE ${quoteLiteral(`%${escapeLike(val)}%`)} ESCAPE '\\'`
      );
    }
  }
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

export async function previewPostgresTableOnServer(input: {
  dbName: string;
  schema: string;
  table: string;
  limit?: number;
  search?: string;
  filterColumn?: string;
  filterOp?: string;
  filterValue?: string;
  dryRun: boolean;
}): Promise<{
  dbName: string;
  schema: string;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  limit: number;
  dryRun: boolean;
}> {
  const dbName = input.dbName.trim().toLowerCase();
  const schema = input.schema.trim();
  const table = input.table.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid PostgreSQL database name: ${input.dbName}`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema name: ${input.schema}`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${input.table}`);
  }
  const limit = Math.max(1, Math.min(200, Number(input.limit ?? 50) || 50));

  if (process.platform === "win32" || input.dryRun) {
    return {
      dbName,
      schema,
      table,
      columns: [],
      rows: [],
      limit,
      dryRun: true,
    };
  }

  const columns = await listTableColumnNames(dbName, schema, table);
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const whereSql = buildPreviewWhere({
    columns,
    search: input.search,
    filterColumn: input.filterColumn,
    filterOp: input.filterOp,
    filterValue: input.filterValue,
  });
  const sql = `
SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
FROM (
  SELECT * FROM ${qualified}${whereSql} LIMIT ${limit}
) q`;

  const raw = (await psqlJsonQuery(dbName, sql)) as
    | Record<string, unknown>[]
    | null;
  const rows = Array.isArray(raw) ? raw : [];

  return { dbName, schema, table, columns, rows, limit, dryRun: false };
}

export async function queryPostgresSqlOnServer(input: {
  dbName: string;
  sql: string;
  dryRun: boolean;
}): Promise<{
  command: string;
  columns: string[];
  rows: Record<string, unknown>[];
  dryRun: boolean;
}> {
  const dbName = input.dbName.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid PostgreSQL database name: ${input.dbName}`);
  }
  const sql = input.sql.trim().replace(/;+\s*$/, "");
  if (!sql || sql.length > 8000) {
    throw new Error("SQL is required and must be under 8000 characters");
  }
  if (sql.includes(";")) {
    throw new Error("Run one SQL statement at a time");
  }
  if (
    /\b(drop\s+database|create\s+database|alter\s+system|copy\s+|pg_read_file|lo_import)\b/i.test(
      sql
    )
  ) {
    throw new Error("This statement is not allowed");
  }

  const command = (sql.match(/^\s*([a-zA-Z]+)/)?.[1] || "SQL").toUpperCase();
  if (process.platform === "win32" || input.dryRun) {
    return { command, columns: [], rows: [], dryRun: true };
  }

  const isResult =
    /^\s*(with|select|table|values|explain|show)\b/i.test(sql);
  if (isResult) {
    const hasLimit = /\blimit\s+\d+/i.test(sql);
    const inner = hasLimit ? sql : `${sql}\nLIMIT 200`;
    const wrapped = `
SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
FROM (
  ${inner}
) q`;
    const raw = (await psqlJsonQuery(dbName, wrapped)) as
      | Record<string, unknown>[]
      | null;
    const rows = Array.isArray(raw) ? raw : [];
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    return { command, columns, rows, dryRun: false };
  }

  await runPsql(sql, false, dbName);
  return { command, columns: [], rows: [], dryRun: false };
}

export type CreatePostgresColumnInput = {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: string | null;
};

const ALLOWED_PG_TYPES = new Set([
  "text",
  "integer",
  "bigint",
  "smallint",
  "boolean",
  "real",
  "double precision",
  "numeric",
  "uuid",
  "date",
  "timestamp",
  "timestamptz",
  "jsonb",
  "json",
  "bytea",
  "serial",
  "bigserial",
]);

function normalizeColumnType(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (ALLOWED_PG_TYPES.has(value)) {
    if (value === "timestamp") return "timestamp without time zone";
    if (value === "timestamptz") return "timestamp with time zone";
    return value;
  }
  const varchar = value.match(/^varchar\((\d{1,5})\)$/);
  if (varchar) {
    const n = Number(varchar[1]);
    if (n >= 1 && n <= 10485760) return `character varying(${n})`;
  }
  const numeric = value.match(/^numeric\((\d{1,3})(?:,(\d{1,3}))?\)$/);
  if (numeric) {
    const p = Number(numeric[1]);
    const s = numeric[2] !== undefined ? Number(numeric[2]) : undefined;
    if (p >= 1 && p <= 1000 && (s === undefined || (s >= 0 && s <= p))) {
      return s === undefined ? `numeric(${p})` : `numeric(${p},${s})`;
    }
  }
  throw new Error(
    `Unsupported column type '${raw}'. Use a common type like text, integer, boolean, uuid, timestamptz, jsonb, serial, or varchar(255).`
  );
}

function assertSafeIdent(ident: string, label: string): string {
  const value = ident.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) || value.length > 63) {
    throw new Error(`Invalid ${label}: ${ident}`);
  }
  return value;
}

function normalizeDefaultSql(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  if (
    upper === "NULL" ||
    upper === "TRUE" ||
    upper === "FALSE" ||
    upper === "CURRENT_TIMESTAMP" ||
    upper === "CURRENT_DATE" ||
    upper === "NOW()" ||
    upper === "GEN_RANDOM_UUID()"
  ) {
    return upper === "NOW()"
      ? "NOW()"
      : upper === "GEN_RANDOM_UUID()"
        ? "gen_random_uuid()"
        : upper;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  // single-quoted string literal only
  if (/^'(?:[^']|'')*'$/.test(value)) return value;
  // bare text → quote it
  if (!/['\\;]/.test(value) && value.length <= 200) {
    return quoteLiteral(value);
  }
  throw new Error(
    `Unsafe default value. Use NULL, TRUE/FALSE, a number, CURRENT_TIMESTAMP, gen_random_uuid(), or a short text value.`
  );
}

export async function createPostgresTableOnServer(input: {
  dbName: string;
  roleName: string;
  schema?: string;
  table: string;
  columns: CreatePostgresColumnInput[];
  dryRun: boolean;
}) {
  const dbName = assertSafeIdent(input.dbName.trim().toLowerCase(), "database name");
  const roleName = assertSafeIdent(
    input.roleName.trim().toLowerCase(),
    "role name"
  );
  const schema = assertSafeIdent(input.schema?.trim() || "public", "schema name");
  const table = assertSafeIdent(input.table.trim(), "table name");
  if (!/^[a-z][a-z0-9_]*$/.test(table.toLowerCase())) {
    throw new Error(
      "Table name must start with a letter and use letters, digits, or _"
    );
  }

  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    throw new Error("Add at least one column");
  }
  if (input.columns.length > 40) {
    throw new Error("A table can have at most 40 columns from the panel");
  }

  const seen = new Set<string>();
  const pkCols: string[] = [];
  const defs: string[] = [];

  for (const raw of input.columns) {
    const name = assertSafeIdent(raw.name, "column name").toLowerCase();
    if (seen.has(name)) {
      throw new Error(`Duplicate column name: ${name}`);
    }
    seen.add(name);
    const typeSql = normalizeColumnType(String(raw.type || ""));
    const isSerial = typeSql === "serial" || typeSql === "bigserial";
    const nullable = raw.nullable !== false && !raw.primaryKey;
    const defaultSql = isSerial
      ? null
      : normalizeDefaultSql(raw.defaultValue ?? null);

    let piece = `${quoteIdent(name)} ${typeSql}`;
    if (!nullable) piece += " NOT NULL";
    if (defaultSql) piece += ` DEFAULT ${defaultSql}`;
    defs.push(piece);
    if (raw.primaryKey) pkCols.push(name);
  }

  if (pkCols.length > 0) {
    defs.push(
      `PRIMARY KEY (${pkCols.map((c) => quoteIdent(c)).join(", ")})`
    );
  }

  await appendMap(`create_table ${dbName}.${schema}.${table}`);

  if (process.platform === "win32" || input.dryRun) {
    return {
      dbName,
      schema,
      table,
      columns: input.columns.length,
      dryRun: true as const,
    };
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const createSql = `CREATE TABLE ${qualified} (\n  ${defs.join(",\n  ")}\n);`;
  await runPsql(createSql, false, dbName);
  await runPsql(
    `ALTER TABLE ${qualified} OWNER TO ${quoteIdent(roleName)};`,
    false,
    dbName
  );
  await runPsql(
    `GRANT ALL ON TABLE ${qualified} TO ${quoteIdent(roleName)};`,
    false,
    dbName
  );

  for (const col of [...seen]) {
    try {
      const seqName = (await psqlJsonQuery(
        dbName,
        `SELECT to_json(pg_get_serial_sequence(${quoteLiteral(`${schema}.${table}`)}, ${quoteLiteral(col)}))`
      )) as string | null;
      if (seqName) {
        await runPsql(
          `ALTER SEQUENCE ${seqName} OWNER TO ${quoteIdent(roleName)};`,
          false,
          dbName
        );
        await runPsql(
          `GRANT ALL ON SEQUENCE ${seqName} TO ${quoteIdent(roleName)};`,
          false,
          dbName
        );
      }
    } catch {
      /* ignore non-serial columns */
    }
  }

  return {
    dbName,
    schema,
    table,
    columns: input.columns.length,
    dryRun: false as const,
  };
}

function columnDefinitionSql(raw: CreatePostgresColumnInput): string {
  const name = assertSafeIdent(raw.name, "column name").toLowerCase();
  const typeSql = normalizeColumnType(String(raw.type || ""));
  const isSerial = typeSql === "serial" || typeSql === "bigserial";
  const nullable = raw.nullable !== false && !raw.primaryKey;
  const defaultSql = isSerial
    ? null
    : normalizeDefaultSql(raw.defaultValue ?? null);
  let piece = `${quoteIdent(name)} ${typeSql}`;
  if (!nullable) piece += " NOT NULL";
  if (defaultSql) piece += ` DEFAULT ${defaultSql}`;
  return piece;
}

export async function deletePostgresTableOnServer(input: {
  dbName: string;
  schema?: string;
  table: string;
  dryRun: boolean;
}) {
  const dbName = assertSafeIdent(input.dbName.trim().toLowerCase(), "database name");
  const schema = assertSafeIdent(input.schema?.trim() || "public", "schema name");
  const table = assertSafeIdent(input.table.trim(), "table name");
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  await appendMap(`drop_table ${dbName}.${schema}.${table}`);

  if (process.platform === "win32" || input.dryRun) {
    return { dbName, schema, table, dryRun: true as const };
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  await runPsql(`DROP TABLE IF EXISTS ${qualified} CASCADE;`, false, dbName);
  return { dbName, schema, table, dryRun: false as const };
}

export async function alterPostgresTableOnServer(input: {
  dbName: string;
  roleName: string;
  schema?: string;
  table: string;
  newName?: string;
  addColumns?: CreatePostgresColumnInput[];
  dropColumns?: string[];
  dryRun: boolean;
}) {
  const dbName = assertSafeIdent(input.dbName.trim().toLowerCase(), "database name");
  const roleName = assertSafeIdent(
    input.roleName.trim().toLowerCase(),
    "role name"
  );
  const schema = assertSafeIdent(input.schema?.trim() || "public", "schema name");
  let table = assertSafeIdent(input.table.trim(), "table name");
  const addColumns = Array.isArray(input.addColumns) ? input.addColumns : [];
  const dropColumns = Array.isArray(input.dropColumns) ? input.dropColumns : [];
  const newNameRaw = input.newName?.trim();

  if (!newNameRaw && addColumns.length === 0 && dropColumns.length === 0) {
    throw new Error("Nothing to change — rename, add columns, or drop columns");
  }
  if (addColumns.length > 20) {
    throw new Error("Add at most 20 columns at once");
  }
  if (dropColumns.length > 40) {
    throw new Error("Drop at most 40 columns at once");
  }

  await appendMap(
    `alter_table ${dbName}.${schema}.${table} rename=${newNameRaw || "-"} add=${addColumns.length} drop=${dropColumns.length}`
  );

  if (process.platform === "win32" || input.dryRun) {
    return {
      dbName,
      schema,
      table: newNameRaw || table,
      added: addColumns.length,
      dropped: dropColumns.length,
      renamed: Boolean(newNameRaw && newNameRaw !== table),
      dryRun: true as const,
    };
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  let qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  for (const col of dropColumns) {
    const colName = assertSafeIdent(col, "column name");
    await runPsql(
      `ALTER TABLE ${qualified} DROP COLUMN IF EXISTS ${quoteIdent(colName)} CASCADE;`,
      false,
      dbName
    );
  }

  for (const col of addColumns) {
    const def = columnDefinitionSql(col);
    await runPsql(`ALTER TABLE ${qualified} ADD COLUMN ${def};`, false, dbName);
    const colName = assertSafeIdent(col.name, "column name").toLowerCase();
    try {
      const seqName = (await psqlJsonQuery(
        dbName,
        `SELECT to_json(pg_get_serial_sequence(${quoteLiteral(`${schema}.${table}`)}, ${quoteLiteral(colName)}))`
      )) as string | null;
      if (seqName) {
        await runPsql(
          `ALTER SEQUENCE ${seqName} OWNER TO ${quoteIdent(roleName)};`,
          false,
          dbName
        );
        await runPsql(
          `GRANT ALL ON SEQUENCE ${seqName} TO ${quoteIdent(roleName)};`,
          false,
          dbName
        );
      }
    } catch {
      /* ignore */
    }
  }

  if (newNameRaw && newNameRaw !== table) {
    const next = assertSafeIdent(newNameRaw, "table name");
    if (!/^[a-z][a-z0-9_]*$/.test(next.toLowerCase())) {
      throw new Error(
        "Table name must start with a letter and use letters, digits, or _"
      );
    }
    await runPsql(
      `ALTER TABLE ${qualified} RENAME TO ${quoteIdent(next)};`,
      false,
      dbName
    );
    table = next;
    qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  }

  await runPsql(
    `ALTER TABLE ${qualified} OWNER TO ${quoteIdent(roleName)};`,
    false,
    dbName
  ).catch(() => undefined);

  return {
    dbName,
    schema,
    table,
    added: addColumns.length,
    dropped: dropColumns.length,
    renamed: Boolean(newNameRaw),
    dryRun: false as const,
  };
}

function sqlLiteral(raw: unknown): string {
  if (raw === null || raw === undefined) return "NULL";
  if (typeof raw === "boolean") return raw ? "TRUE" : "FALSE";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "object") return quoteLiteral(JSON.stringify(raw));
  const text = String(raw);
  if (text === "") return "NULL";
  return quoteLiteral(text);
}

function assertIdent(name: string, label: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
}

function sqlWhereAnd(where: Record<string, unknown>): string {
  const whereCols = Object.keys(where);
  if (whereCols.length === 0) {
    throw new Error("A primary key is required to delete a row");
  }
  for (const k of whereCols) assertIdent(k, "column name");
  return whereCols
    .map((c) => `${quoteIdent(c)} = ${sqlLiteral(where[c])}`)
    .join(" AND ");
}

export async function mutatePostgresTableRowsOnServer(input: {
  dbName: string;
  schema: string;
  table: string;
  op: "insert" | "update" | "delete";
  values?: Record<string, unknown>;
  where?: Record<string, unknown>;
  whereList?: Record<string, unknown>[];
  dryRun: boolean;
}): Promise<{
  dbName: string;
  schema: string;
  table: string;
  op: string;
  dryRun: boolean;
}> {
  const dbName = input.dbName.trim().toLowerCase();
  const schema = input.schema.trim() || "public";
  const table = input.table.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid PostgreSQL database name: ${input.dbName}`);
  }
  assertIdent(schema, "schema name");
  assertIdent(table, "table name");
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const values = input.values ?? {};
  const where = input.where ?? {};
  const whereList = Array.isArray(input.whereList) ? input.whereList : [];

  if (process.platform === "win32" || input.dryRun) {
    return { dbName, schema, table, op: input.op, dryRun: true };
  }

  let sql = "";
  if (input.op === "insert") {
    const cols = Object.keys(values).filter((k) => {
      assertIdent(k, "column name");
      const v = values[k];
      return v !== undefined && v !== "";
    });
    if (cols.length === 0) {
      sql = `INSERT INTO ${qualified} DEFAULT VALUES`;
    } else {
      sql = `INSERT INTO ${qualified} (${cols.map(quoteIdent).join(", ")}) VALUES (${cols
        .map((c) => sqlLiteral(values[c]))
        .join(", ")})`;
    }
  } else if (input.op === "update") {
    const setCols = Object.keys(values).filter((k) => {
      assertIdent(k, "column name");
      return !Object.prototype.hasOwnProperty.call(where, k);
    });
    const whereCols = Object.keys(where);
    if (setCols.length === 0) throw new Error("No columns to update");
    if (whereCols.length === 0) {
      throw new Error("A primary key is required to update a row");
    }
    for (const k of whereCols) assertIdent(k, "column name");
    sql = `UPDATE ${qualified} SET ${setCols
      .map((c) => `${quoteIdent(c)} = ${sqlLiteral(values[c])}`)
      .join(", ")} WHERE ${whereCols
      .map((c) => `${quoteIdent(c)} = ${sqlLiteral(where[c])}`)
      .join(" AND ")}`;
  } else if (input.op === "delete") {
    if (whereList.length > 0) {
      if (whereList.length > 100) {
        throw new Error("Cannot delete more than 100 rows at once");
      }
      sql = `DELETE FROM ${qualified} WHERE ${whereList
        .map((w) => `(${sqlWhereAnd(w)})`)
        .join(" OR ")}`;
    } else {
      sql = `DELETE FROM ${qualified} WHERE ${sqlWhereAnd(where)}`;
    }
  } else {
    throw new Error("Unsupported row operation");
  }

  await runPsql(sql, false, dbName);
  return { dbName, schema, table, op: input.op, dryRun: false };
}

export type PostgresDumpFormat = "sql" | "custom";

const MAX_DUMP_BYTES = 200 * 1024 * 1024;

function dumpTempPath(dbName: string, ext: string): string {
  return path.join(
    "/tmp",
    `naviyra-db-${dbName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  );
}

export async function exportPostgresDatabaseOnServer(input: {
  dbName: string;
  format?: PostgresDumpFormat;
  dryRun: boolean;
}): Promise<{
  dbName: string;
  format: PostgresDumpFormat;
  fileName: string;
  contentBase64: string;
  bytes: number;
  dryRun: boolean;
}> {
  const dbName = assertSafeIdent(input.dbName.trim().toLowerCase(), "database name");
  const format: PostgresDumpFormat = input.format === "custom" ? "custom" : "sql";
  const fileName =
    format === "custom" ? `${dbName}.dump` : `${dbName}.sql`;

  if (process.platform === "win32" || input.dryRun) {
    const placeholder = `-- Naviyra dry-run dump of ${dbName}\n`;
    return {
      dbName,
      format: "sql",
      fileName: `${dbName}.sql`,
      contentBase64: Buffer.from(placeholder, "utf8").toString("base64"),
      bytes: placeholder.length,
      dryRun: true,
    };
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  const bins = await ensurePostgresReady();
  if (!bins.pgDump) throw new Error("pg_dump not found");
  const ext = format === "custom" ? "dump" : "sql";
  const tmp = dumpTempPath(dbName, ext);
  const args =
    format === "custom"
      ? ["-Fc", "-f", tmp, dbName]
      : ["-Fp", "--no-owner", "--no-acl", "-f", tmp, dbName];

  try {
    await execAsPostgres(bins.pgDump, args, undefined, {
      timeout: PG_DUMP_TIMEOUT_MS,
    });
    await execAsPostgres("/usr/bin/chmod", ["644", tmp], undefined, {
      timeout: 15_000,
    }).catch(() => undefined);
    const buf = await fs.readFile(tmp);
    if (buf.length > MAX_DUMP_BYTES) {
      throw new Error(
        `Dump is ${Math.round(buf.length / 1024 / 1024)} MB (limit ${MAX_DUMP_BYTES / 1024 / 1024} MB). Use Backups for larger databases.`
      );
    }
    return {
      dbName,
      format,
      fileName,
      contentBase64: buf.toString("base64"),
      bytes: buf.length,
      dryRun: false,
    };
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export function detectPostgresDumpFormat(
  fileName: string,
  header: Buffer
): PostgresDumpFormat {
  if (header.subarray(0, 5).toString("ascii") === "PGDMP") return "custom";
  if (/\.dump$/i.test(fileName) || /\.backup$/i.test(fileName)) return "custom";
  return "sql";
}

export async function reassignPostgresOwnershipOnServer(input: {
  dbName: string;
  roleName: string;
  dryRun: boolean;
}): Promise<{ dbName: string; roleName: string; dryRun: boolean }> {
  const dbName = assertSafeIdent(
    input.dbName.trim().toLowerCase(),
    "database name"
  );
  const roleName = assertSafeIdent(
    input.roleName.trim().toLowerCase(),
    "role name"
  );
  const db = quoteIdent(dbName);
  const role = quoteIdent(roleName);

  if (process.platform === "win32" || input.dryRun) {
    return { dbName, roleName, dryRun: true };
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  await runPsql(`ALTER DATABASE ${db} OWNER TO ${role};`, false);
  await runPsql(`GRANT ALL PRIVILEGES ON DATABASE ${db} TO ${role};`, false);
  await runPsql(
    `GRANT ALL ON SCHEMA public TO ${role}; ALTER SCHEMA public OWNER TO ${role};`,
    false,
    dbName
  );
  await runPsql(
    `DO $naviyra$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.relkind, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      CASE rec.relkind
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        ELSE 'TABLE'
      END,
      rec.nspname,
      rec.relname,
      ${quoteLiteral(roleName)}
    );
  END LOOP;

  FOR rec IN
    SELECT n.nspname AS nsp, p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) OWNER TO %I',
        rec.nsp,
        rec.name,
        rec.args,
        ${quoteLiteral(roleName)}
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END
$naviyra$;`,
    false,
    dbName
  );
  await runPsql(
    `GRANT ALL ON ALL TABLES IN SCHEMA public TO ${role};`,
    false,
    dbName
  );
  await runPsql(
    `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${role};`,
    false,
    dbName
  );
  await runPsql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role};`,
    false,
    dbName
  );
  await runPsql(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${role};`,
    false,
    dbName
  );

  return { dbName, roleName, dryRun: false };
}

function rewriteSqlDumpForReplace(sql: string): string {
  return sql
    .replace(/\bCREATE\s+SCHEMA\s+public\s*;/gi, "CREATE SCHEMA IF NOT EXISTS public;")
    .replace(/\bDROP\s+SCHEMA\s+public\s*;/gi, "DROP SCHEMA IF EXISTS public CASCADE;")
    .replace(/\bCREATE\s+(?!OR\s+REPLACE\s+)FUNCTION\b/gi, "CREATE OR REPLACE FUNCTION")
    .replace(/\bCREATE\s+(?!OR\s+REPLACE\s+)PROCEDURE\b/gi, "CREATE OR REPLACE PROCEDURE")
    .replace(/\bCREATE\s+(?!OR\s+REPLACE\s+)VIEW\b/gi, "CREATE OR REPLACE VIEW");
}

async function resetPublicSchemaForImport(dbName: string, roleName?: string) {
  const role = roleName
    ? quoteIdent(assertSafeIdent(roleName.trim().toLowerCase(), "role name"))
    : null;
  await runPsql(`DROP SCHEMA IF EXISTS public CASCADE;`, false, dbName);
  await runPsql(`CREATE SCHEMA public;`, false, dbName);
  await runPsql(`GRANT ALL ON SCHEMA public TO PUBLIC;`, false, dbName);
  if (role) {
    await runPsql(`GRANT ALL ON SCHEMA public TO ${role};`, false, dbName);
    await runPsql(`ALTER SCHEMA public OWNER TO ${role};`, false, dbName);
  }
}

export async function importPostgresDatabaseOnServer(input: {
  dbName: string;
  roleName?: string;
  format?: PostgresDumpFormat;
  fileName?: string;
  contentBase64: string;
  dryRun: boolean;
}): Promise<{ dbName: string; format: PostgresDumpFormat; dryRun: boolean }> {
  const dbName = assertSafeIdent(input.dbName.trim().toLowerCase(), "database name");
  const buf = Buffer.from(input.contentBase64, "base64");
  if (!buf.length) throw new Error("Import file is empty");
  if (buf.length > MAX_DUMP_BYTES) {
    throw new Error(
      `Import is ${Math.round(buf.length / 1024 / 1024)} MB (limit ${MAX_DUMP_BYTES / 1024 / 1024} MB).`
    );
  }
  const format =
    input.format ??
    detectPostgresDumpFormat(input.fileName || "", buf.subarray(0, 16));

  if (process.platform === "win32" || input.dryRun) {
    return { dbName, format, dryRun: true };
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  await resetPublicSchemaForImport(dbName, input.roleName);

  const bins = await ensurePostgresReady();
  const ext = format === "custom" ? "dump" : "sql";
  const tmp = dumpTempPath(dbName, ext);
  const payload =
    format === "sql"
      ? Buffer.from(rewriteSqlDumpForReplace(buf.toString("utf8")), "utf8")
      : buf;
  await fs.writeFile(tmp, payload);
  await fs.chmod(tmp, 0o644);

  try {
    if (format === "custom") {
      if (!bins.pgRestore) throw new Error("pg_restore not found");
      await execAsPostgres(
        bins.pgRestore,
        [
          "-d",
          dbName,
          "--no-owner",
          "--no-acl",
          "--clean",
          "--if-exists",
          tmp,
        ],
        undefined,
        { timeout: PG_DUMP_TIMEOUT_MS }
      );
    } else {
      await execAsPostgres(
        bins.psql,
        ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", tmp],
        undefined,
        { timeout: PG_DUMP_TIMEOUT_MS }
      );
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }

  if (input.roleName) {
    await reassignPostgresOwnershipOnServer({
      dbName,
      roleName: input.roleName,
      dryRun: false,
    });
  }

  return { dbName, format, dryRun: false };
}
