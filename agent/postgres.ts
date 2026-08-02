/**
 * Customer PostgreSQL databases (Linux).
 * Creates roles + databases via psql as the postgres OS user.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_ROOT } from "./paths";

const exec = promisify(execFile);

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
    .slice(0, 24);
  if (!cleaned || !/^[a-z]/.test(cleaned)) {
    throw new Error(
      "Database name must start with a letter and use letters, digits, or _"
    );
  }
  return cleaned;
}

export function buildPgNames(domainName: string, label: string): {
  label: string;
  dbName: string;
  roleName: string;
} {
  const safe = sanitizePgLabel(label);
  const hash = createHash("sha1")
    .update(domainName.toLowerCase())
    .digest("hex")
    .slice(0, 8);
  const dbName = `n_${hash}_${safe}`.slice(0, 63);
  const roleName = dbName;
  return { label: safe, dbName, roleName };
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
  const args = ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1"];
  if (database) {
    args.push("-d", database);
  }
  args.push("-c", sql);
  await exec("sudo", args, { maxBuffer: 2 * 1024 * 1024 });
}

async function databaseExists(dbName: string): Promise<boolean> {
  const { stdout } = await exec(
    "sudo",
    [
      "-u",
      "postgres",
      "psql",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(dbName)}`,
    ],
    { maxBuffer: 1024 * 1024 }
  );
  return stdout.trim() === "1";
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

  await runPsql(
    `DO $$ BEGIN
       CREATE ROLE ${role} LOGIN PASSWORD ${password};
     EXCEPTION WHEN duplicate_object THEN
       ALTER ROLE ${role} WITH LOGIN PASSWORD ${password};
     END $$;`,
    false
  );

  if (!(await databaseExists(input.dbName))) {
    await runPsql(
      `CREATE DATABASE ${db} OWNER ${role} ENCODING 'UTF8' TEMPLATE template0;`,
      false
    );
  } else {
    await runPsql(`ALTER DATABASE ${db} OWNER TO ${role};`, false);
  }

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
  const { stdout } = await exec(
    "sudo",
    ["-u", "postgres", "psql", "-d", database, "-tAc", sql],
    { maxBuffer: 8 * 1024 * 1024 }
  );
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
  columns: PostgresColumnInfo[];
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

export async function inspectPostgresSchemaOnServer(input: {
  dbName: string;
  dryRun: boolean;
}): Promise<{ dbName: string; tables: PostgresTableInfo[]; dryRun: boolean }> {
  const dbName = input.dbName.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid PostgreSQL database name: ${input.dbName}`);
  }

  if (process.platform === "win32" || input.dryRun) {
    return { dbName, tables: [], dryRun: true };
  }

  if (!(await databaseExists(dbName))) {
    throw new Error(`Database '${dbName}' was not found on the server`);
  }

  const tablesSql = `
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.schema_name, t.table_name), '[]'::json)
FROM (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relkind::text AS relkind,
    COALESCE(s.n_live_tup, 0)::bigint AS approx_rows
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
    return {
      schema: t.schema_name,
      name: t.table_name,
      kind: mapRelKind(t.relkind),
      approxRows: Number.isFinite(approx as number) ? (approx as number) : null,
      columns: columnsByTable.get(key) ?? [],
    };
  });

  return { dbName, tables, dryRun: false };
}

export async function previewPostgresTableOnServer(input: {
  dbName: string;
  schema: string;
  table: string;
  limit?: number;
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
  const limit = Math.max(1, Math.min(100, Number(input.limit ?? 50) || 50));

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

  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const sql = `
SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)
FROM (
  SELECT * FROM ${qualified} LIMIT ${limit}
) q`;

  const raw = (await psqlJsonQuery(dbName, sql)) as
    | Record<string, unknown>[]
    | null;
  const rows = Array.isArray(raw) ? raw : [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  // If empty table, still return column names from information_schema
  if (columns.length === 0) {
    const colsSql = `
SELECT COALESCE(json_agg(column_name ORDER BY ordinal_position), '[]'::json)
FROM information_schema.columns
WHERE table_schema = ${quoteLiteral(schema)}
  AND table_name = ${quoteLiteral(table)}`;
    const names = (await psqlJsonQuery(dbName, colsSql)) as string[] | null;
    return {
      dbName,
      schema,
      table,
      columns: Array.isArray(names) ? names : [],
      rows: [],
      limit,
      dryRun: false,
    };
  }

  return { dbName, schema, table, columns, rows, limit, dryRun: false };
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
