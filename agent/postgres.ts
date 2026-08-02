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
  if (!/^[a-z_][a-z0-9_]*$/.test(ident)) {
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
