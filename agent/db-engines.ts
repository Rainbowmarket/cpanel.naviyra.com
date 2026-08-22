import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { CONFIG_ROOT } from "./paths";
import { runHostCommand, whichBin } from "./pkg-install";

function ident(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63);
  if (!cleaned || !/^[a-z]/.test(cleaned)) {
    throw new Error("Name must start with a letter and use letters, digits, or _");
  }
  return cleaned;
}

function lit(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

async function mysqlExec(sql: string, bin = "mysql") {
  const exe = (await whichBin(bin)) || (await whichBin("mariadb")) || bin;
  await runHostCommand(exe, ["-e", sql], { timeout: 60000 });
}

export async function probeMysql(): Promise<{ ok: boolean; detail: string }> {
  const extra = ["/usr/sbin/mysqld", "/usr/sbin/mariadbd", "/usr/bin/mysql", "/usr/bin/mariadb"];
  for (const file of extra) {
    if (fs.existsSync(file)) return { ok: true, detail: file };
  }
  const bin =
    (await whichBin("mysqld")) ||
    (await whichBin("mariadbd")) ||
    (await whichBin("mysql")) ||
    (await whichBin("mariadb"));
  return bin
    ? { ok: true, detail: bin }
    : { ok: false, detail: "MySQL/MariaDB server is not installed" };
}

export async function createMysqlDatabase(input: {
  dbName: string;
  roleName: string;
  password: string;
  dryRun: boolean;
  mariadb?: boolean;
}) {
  const db = ident(input.dbName);
  const role = ident(input.roleName);
  if (input.dryRun) return { dbName: db, roleName: role, dryRun: true };
  await mysqlExec(`CREATE DATABASE IF NOT EXISTS \`${db}\``);
  try {
    await mysqlExec(
      `CREATE USER '${role}'@'localhost' IDENTIFIED BY '${lit(input.password)}'`
    );
  } catch {
    try {
      await mysqlExec(
        `ALTER USER '${role}'@'localhost' IDENTIFIED BY '${lit(input.password)}'`
      );
    } catch {
      await mysqlExec(
        `SET PASSWORD FOR '${role}'@'localhost' = PASSWORD('${lit(input.password)}')`
      );
    }
  }
  await mysqlExec(
    `GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${role}'@'localhost'`
  );
  await mysqlExec("FLUSH PRIVILEGES");
  return { dbName: db, roleName: role, port: 3306 };
}

export async function deleteMysqlDatabase(input: {
  dbName: string;
  roleName: string;
  dryRun: boolean;
}) {
  const db = ident(input.dbName);
  const role = ident(input.roleName);
  if (input.dryRun) return { dbName: db, dryRun: true };
  await mysqlExec(
    `DROP DATABASE IF EXISTS \`${db}\`; DROP USER IF EXISTS '${role}'@'localhost'; FLUSH PRIVILEGES;`
  );
  return { dbName: db };
}

export async function resetMysqlPassword(input: {
  roleName: string;
  password: string;
  dryRun: boolean;
}) {
  const role = ident(input.roleName);
  if (input.dryRun) return { roleName: role, dryRun: true };
  await mysqlExec(
    `ALTER USER '${role}'@'localhost' IDENTIFIED BY '${lit(input.password)}'; FLUSH PRIVILEGES;`
  );
  return { roleName: role };
}

export async function probeRedis(): Promise<{ ok: boolean; detail: string }> {
  const bin = (await whichBin("redis-server")) || (await whichBin("redis-cli"));
  return bin ? { ok: true, detail: bin } : { ok: false, detail: "Redis is not installed" };
}

export async function createRedisUser(input: {
  roleName: string;
  password: string;
  dryRun: boolean;
}) {
  const role = ident(input.roleName);
  if (input.dryRun) return { dbName: "0", roleName: role, dryRun: true };
  const cli = (await whichBin("redis-cli")) || "redis-cli";
  await runHostCommand(cli, [
    "ACL",
    "SETUSER",
    role,
    "on",
    `>${input.password}`,
    "~*",
    "&*",
    "+@all",
  ]);
  return { dbName: "0", roleName: role, port: 6379 };
}

export async function deleteRedisUser(input: { roleName: string; dryRun: boolean }) {
  const role = ident(input.roleName);
  if (input.dryRun) return { roleName: role, dryRun: true };
  const cli = (await whichBin("redis-cli")) || "redis-cli";
  await runHostCommand(cli, ["ACL", "DELUSER", role]);
  return { roleName: role };
}

export async function probeMongo(): Promise<{ ok: boolean; detail: string }> {
  const bin =
    (await whichBin("mongod")) ||
    (await whichBin("mongosh")) ||
    (await whichBin("mongo"));
  return bin ? { ok: true, detail: bin } : { ok: false, detail: "MongoDB is not installed" };
}

export async function createMongoDatabase(input: {
  dbName: string;
  roleName: string;
  password: string;
  dryRun: boolean;
}) {
  const db = ident(input.dbName);
  const role = ident(input.roleName);
  if (input.dryRun) return { dbName: db, roleName: role, dryRun: true };
  const shell = (await whichBin("mongosh")) || (await whichBin("mongo")) || "mongosh";
  const js = `db.getSiblingDB('${db}').createUser({user:'${role}',pwd:'${lit(input.password)}',roles:[{role:'readWrite',db:'${db}'}]})`;
  await runHostCommand(shell, ["--eval", js], { timeout: 60000 });
  return { dbName: db, roleName: role, port: 27017 };
}

export async function deleteMongoDatabase(input: {
  dbName: string;
  roleName: string;
  dryRun: boolean;
}) {
  const db = ident(input.dbName);
  const role = ident(input.roleName);
  if (input.dryRun) return { dbName: db, dryRun: true };
  const shell = (await whichBin("mongosh")) || (await whichBin("mongo")) || "mongosh";
  await runHostCommand(
    shell,
    [
      "--eval",
      `db.getSiblingDB('${db}').dropUser('${role}'); db.getSiblingDB('${db}').dropDatabase()`,
    ],
    { timeout: 60000 }
  );
  return { dbName: db };
}

export async function probeClickHouse(): Promise<{ ok: boolean; detail: string }> {
  const bin =
    (await whichBin("clickhouse-server")) ||
    (await whichBin("clickhouse-client")) ||
    (await whichBin("clickhouse"));
  return bin
    ? { ok: true, detail: bin }
    : { ok: false, detail: "ClickHouse is not installed" };
}

export async function createClickHouseDatabase(input: {
  dbName: string;
  roleName: string;
  password: string;
  dryRun: boolean;
}) {
  const db = ident(input.dbName);
  const role = ident(input.roleName);
  if (input.dryRun) return { dbName: db, roleName: role, dryRun: true };
  const cli = (await whichBin("clickhouse-client")) || "clickhouse-client";
  await runHostCommand(cli, [
    "-q",
    `CREATE DATABASE IF NOT EXISTS ${db}; CREATE USER IF NOT EXISTS ${role} IDENTIFIED BY '${lit(input.password)}'; GRANT ALL ON ${db}.* TO ${role}`,
  ]);
  return { dbName: db, roleName: role, port: 9000 };
}

export async function deleteClickHouseDatabase(input: {
  dbName: string;
  roleName: string;
  dryRun: boolean;
}) {
  const db = ident(input.dbName);
  const role = ident(input.roleName);
  if (input.dryRun) return { dbName: db, dryRun: true };
  const cli = (await whichBin("clickhouse-client")) || "clickhouse-client";
  await runHostCommand(cli, [
    "-q",
    `DROP DATABASE IF EXISTS ${db}; DROP USER IF EXISTS ${role}`,
  ]);
  return { dbName: db };
}

export async function probeSqlite(): Promise<{ ok: boolean; detail: string }> {
  const bin = await whichBin("sqlite3");
  return bin ? { ok: true, detail: bin } : { ok: false, detail: "sqlite3 is not installed" };
}

export function sqliteFilePath(dbName: string): string {
  return path.join(CONFIG_ROOT, "sqlite", `${ident(dbName)}.db`);
}

export async function createSqliteDatabase(input: {
  dbName: string;
  dryRun: boolean;
}) {
  const db = ident(input.dbName);
  const file = sqliteFilePath(db);
  if (input.dryRun) return { dbName: db, file, dryRun: true };
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  const sqlite = (await whichBin("sqlite3")) || "sqlite3";
  await runHostCommand(sqlite, [file, "VACUUM;"]);
  return { dbName: db, file, roleName: db, port: 0 };
}

export async function deleteSqliteDatabase(input: { dbName: string; dryRun: boolean }) {
  const db = ident(input.dbName);
  const file = sqliteFilePath(db);
  if (input.dryRun) return { dbName: db, dryRun: true };
  await fsPromises.unlink(file).catch(() => undefined);
  return { dbName: db };
}

export async function probeElastic(): Promise<{ ok: boolean; detail: string }> {
  const bin = await whichBin("elasticsearch");
  if (bin) return { ok: true, detail: bin };
  try {
    const { stdout } = await runHostCommand(
      "curl",
      ["-sS", "-m", "3", "http://127.0.0.1:9200"],
      { timeout: 5000 }
    );
    if (stdout.includes("You Know, for Search") || stdout.includes("cluster_name")) {
      return { ok: true, detail: "http://127.0.0.1:9200" };
    }
  } catch {
    /* down */
  }
  return { ok: false, detail: "Elasticsearch is not installed" };
}

export async function createElasticIndex(input: { dbName: string; dryRun: boolean }) {
  const db = ident(input.dbName);
  if (input.dryRun) return { dbName: db, dryRun: true };
  await runHostCommand("curl", [
    "-sS",
    "-m",
    "15",
    "-X",
    "PUT",
    `http://127.0.0.1:9200/${db}`,
  ]);
  return { dbName: db, roleName: db, port: 9200 };
}

export async function deleteElasticIndex(input: { dbName: string; dryRun: boolean }) {
  const db = ident(input.dbName);
  if (input.dryRun) return { dbName: db, dryRun: true };
  await runHostCommand("curl", [
    "-sS",
    "-m",
    "15",
    "-X",
    "DELETE",
    `http://127.0.0.1:9200/${db}`,
  ]);
  return { dbName: db };
}

type SchemaColumn = {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  defaultValue: string | null;
  ordinal: number;
  isPrimaryKey: boolean;
};

type SchemaTable = {
  schema: string;
  name: string;
  kind: string;
  approxRows: number | null;
  columns: SchemaColumn[];
};

function emptyInspect(dbName: string, extra?: Record<string, unknown>) {
  return {
    tables: [] as SchemaTable[],
    dbSizeBytes: null as number | null,
    dbSizePretty: null as string | null,
    pgVersion: extra?.version ?? extra?.pgVersion ?? null,
    indexes: [],
    relations: [],
    functions: [],
    triggers: [],
    enums: [],
  };
}

async function mysqlQuery(sql: string, database?: string): Promise<string> {
  const exe = (await whichBin("mysql")) || (await whichBin("mariadb")) || "mysql";
  const args = database
    ? ["--batch", "--raw", database, "-e", sql]
    : ["--batch", "--raw", "-e", sql];
  const { stdout } = await runHostCommand(exe, args, { timeout: 60000 });
  return stdout;
}

function parseMysqlTsv(stdout: string): { columns: string[]; rows: Record<string, unknown>[] } {
  const lines = stdout.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] === "NULL" ? null : (cells[i] ?? null);
    });
    return row;
  });
  return { columns, rows };
}

async function inspectMysqlLike(dbName: string) {
  const db = ident(dbName);
  let version: string | null = "mysql";
  try {
    const ver = parseMysqlTsv(await mysqlQuery("SELECT VERSION() AS v"));
    version = String(ver.rows[0]?.v ?? "mysql");
  } catch {
    /* keep label */
  }
  const listed = parseMysqlTsv(await mysqlQuery("SHOW TABLES", db));
  const tableNames = listed.rows
    .map((row) => String(Object.values(row)[0] ?? ""))
    .filter(Boolean);
  const { rows } = parseMysqlTsv(
    await mysqlQuery(
      "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='" +
        db +
        "' ORDER BY TABLE_NAME, ORDINAL_POSITION"
    )
  );
  const byTable = new Map<string, SchemaTable>();
  for (const name of tableNames) {
    byTable.set(name, {
      schema: db,
      name,
      kind: "table",
      approxRows: null,
      columns: [],
    });
  }
  for (const row of rows) {
    const name = String(row.TABLE_NAME ?? "");
    if (!name) continue;
    let table = byTable.get(name);
    if (!table) {
      table = {
        schema: db,
        name,
        kind: "table",
        approxRows: null,
        columns: [],
      };
      byTable.set(name, table);
    }
    table.columns.push({
      name: String(row.COLUMN_NAME ?? ""),
      dataType: String(row.DATA_TYPE ?? "text"),
      udtName: String(row.DATA_TYPE ?? "text"),
      nullable: String(row.IS_NULLABLE ?? "YES") === "YES",
      defaultValue: row.COLUMN_DEFAULT == null ? null : String(row.COLUMN_DEFAULT),
      ordinal: Number(row.ORDINAL_POSITION ?? table.columns.length + 1),
      isPrimaryKey: String(row.COLUMN_KEY ?? "") === "PRI",
    });
  }
  return {
    ...emptyInspect(db, { pgVersion: version }),
    tables: [...byTable.values()],
  };
}

async function previewMysqlLike(input: {
  dbName: string;
  table: string;
  limit: number;
}) {
  const db = ident(input.dbName);
  const table = ident(input.table);
  const limit = Math.min(200, Math.max(1, input.limit || 100));
  const parsed = parseMysqlTsv(
    await mysqlQuery(`SELECT * FROM \`${table}\` LIMIT ${limit}`, db)
  );
  return {
    dbName: db,
    schema: "public",
    table,
    columns: parsed.columns,
    rows: parsed.rows,
    limit,
  };
}

export async function inspectHostedDatabase(input: {
  engine: string;
  dbName: string;
  dryRun: boolean;
}) {
  const engine = input.engine || "mysql";
  if (input.dryRun) return emptyInspect(input.dbName, { pgVersion: engine });

  if (engine === "mysql" || engine === "mariadb") {
    return inspectMysqlLike(input.dbName);
  }

  if (engine === "sqlite") {
    const file = sqliteFilePath(input.dbName);
    const sqlite = (await whichBin("sqlite3")) || "sqlite3";
    const { stdout } = await runHostCommand(sqlite, [
      file,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    ]);
    const names = stdout.trim().split(/\s+/).filter(Boolean);
    const tables: SchemaTable[] = [];
    for (const name of names) {
      const info = await runHostCommand(sqlite, [file, `PRAGMA table_info(${ident(name)});`]);
      const cols: SchemaColumn[] = info.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line, i) => {
          const p = line.split("|");
          return {
            name: p[1] || `col${i}`,
            dataType: p[2] || "text",
            udtName: p[2] || "text",
            nullable: p[3] !== "1",
            defaultValue: p[4] || null,
            ordinal: Number(p[0] ?? i),
            isPrimaryKey: p[5] === "1",
          };
        });
      tables.push({ schema: "public", name, kind: "table", approxRows: null, columns: cols });
    }
    return { ...emptyInspect(input.dbName, { pgVersion: "sqlite" }), tables };
  }

  if (engine === "redis") {
    const cli = (await whichBin("redis-cli")) || "redis-cli";
    const { stdout } = await runHostCommand(cli, ["--raw", "SCAN", "0", "COUNT", "100"]);
    const keys = stdout
      .trim()
      .split(/\s+/)
      .filter((k) => k && k !== "0");
    return {
      ...emptyInspect(input.dbName, { pgVersion: "redis" }),
      tables: [
        {
          schema: "public",
          name: "keys",
          kind: "table",
          approxRows: keys.length,
          columns: [
            { name: "key", dataType: "text", udtName: "text", nullable: false, defaultValue: null, ordinal: 1, isPrimaryKey: true },
            { name: "value", dataType: "text", udtName: "text", nullable: true, defaultValue: null, ordinal: 2, isPrimaryKey: false },
          ],
        },
      ],
    };
  }

  if (engine === "clickhouse") {
    const db = ident(input.dbName);
    const cli = (await whichBin("clickhouse-client")) || "clickhouse-client";
    const { stdout } = await runHostCommand(cli, [
      "-q",
      `SELECT name FROM system.tables WHERE database='${db}' FORMAT TSV`,
    ]);
    const names = stdout.trim().split("\n").filter(Boolean);
    const tables: SchemaTable[] = names.map((name) => ({
      schema: "public",
      name,
      kind: "table",
      approxRows: null,
      columns: [{ name: "data", dataType: "text", udtName: "text", nullable: true, defaultValue: null, ordinal: 1, isPrimaryKey: false }],
    }));
    for (const table of tables) {
      try {
        const cols = await runHostCommand(cli, [
          "-q",
          `SELECT name, type FROM system.columns WHERE database='${db}' AND table='${ident(table.name)}' FORMAT TSV`,
        ]);
        table.columns = cols.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line, i) => {
            const [n, t] = line.split("\t");
            return {
              name: n || `c${i}`,
              dataType: t || "text",
              udtName: t || "text",
              nullable: true,
              defaultValue: null,
              ordinal: i + 1,
              isPrimaryKey: false,
            };
          });
      } catch {
        /* keep placeholder */
      }
    }
    return { ...emptyInspect(db, { pgVersion: "clickhouse" }), tables };
  }

  if (engine === "mongodb") {
    const db = ident(input.dbName);
    const shell = (await whichBin("mongosh")) || (await whichBin("mongo")) || "mongosh";
    const { stdout } = await runHostCommand(shell, [
      "--quiet",
      "--eval",
      `db.getSiblingDB('${db}').getCollectionNames().join('\\n')`,
    ]);
    const names = stdout.trim().split("\n").filter(Boolean);
    return {
      ...emptyInspect(db, { pgVersion: "mongodb" }),
      tables: names.map((name) => ({
        schema: "public",
        name,
        kind: "collection",
        approxRows: null,
        columns: [
          { name: "_id", dataType: "objectId", udtName: "objectId", nullable: false, defaultValue: null, ordinal: 1, isPrimaryKey: true },
          { name: "document", dataType: "json", udtName: "json", nullable: true, defaultValue: null, ordinal: 2, isPrimaryKey: false },
        ],
      })),
    };
  }

  if (engine === "elasticsearch") {
    const db = ident(input.dbName);
    return {
      ...emptyInspect(db, { pgVersion: "elasticsearch" }),
      tables: [
        {
          schema: db,
          name: db,
          kind: "index",
          approxRows: null,
          columns: [
            { name: "_id", dataType: "text", udtName: "text", nullable: false, defaultValue: null, ordinal: 1, isPrimaryKey: true },
            { name: "_source", dataType: "json", udtName: "json", nullable: true, defaultValue: null, ordinal: 2, isPrimaryKey: false },
          ],
        },
      ],
    };
  }

  throw new Error(`Browse is not available for ${engine}`);
}

export async function previewHostedTable(input: {
  engine: string;
  dbName: string;
  table: string;
  limit?: number;
  dryRun: boolean;
}) {
  const engine = input.engine || "mysql";
  const limit = Math.min(200, Math.max(1, input.limit || 100));
  if (input.dryRun) {
    return { dbName: input.dbName, schema: "public", table: input.table, columns: [], rows: [], limit };
  }

  if (engine === "mysql" || engine === "mariadb") {
    return previewMysqlLike({ dbName: input.dbName, table: input.table, limit });
  }

  if (engine === "sqlite") {
    const file = sqliteFilePath(input.dbName);
    const sqlite = (await whichBin("sqlite3")) || "sqlite3";
    const table = ident(input.table);
    const { stdout } = await runHostCommand(sqlite, [
      "-header",
      "-separator",
      "\t",
      file,
      `SELECT * FROM ${table} LIMIT ${limit};`,
    ]);
    const parsed = parseMysqlTsv(stdout);
    return { dbName: ident(input.dbName), schema: "public", table, columns: parsed.columns, rows: parsed.rows, limit };
  }

  if (engine === "redis") {
    const cli = (await whichBin("redis-cli")) || "redis-cli";
    const { stdout } = await runHostCommand(cli, ["--raw", "SCAN", "0", "COUNT", String(limit)]);
    const keys = stdout.trim().split(/\s+/).filter((k) => k && k !== "0").slice(0, limit);
    const rows: Record<string, unknown>[] = [];
    for (const key of keys) {
      try {
        const val = await runHostCommand(cli, ["--raw", "GET", key]);
        rows.push({ key, value: val.stdout.trim() });
      } catch {
        rows.push({ key, value: null });
      }
    }
    return { dbName: input.dbName, schema: "public", table: "keys", columns: ["key", "value"], rows, limit };
  }

  if (engine === "clickhouse") {
    const db = ident(input.dbName);
    const table = ident(input.table);
    const cli = (await whichBin("clickhouse-client")) || "clickhouse-client";
    const { stdout } = await runHostCommand(cli, [
      "-q",
      `SELECT * FROM ${db}.${table} LIMIT ${limit} FORMAT TabSeparatedWithNames`,
    ]);
    const parsed = parseMysqlTsv(stdout);
    return { dbName: db, schema: "public", table, columns: parsed.columns, rows: parsed.rows, limit };
  }

  if (engine === "mongodb") {
    const db = ident(input.dbName);
    const table = ident(input.table);
    const shell = (await whichBin("mongosh")) || (await whichBin("mongo")) || "mongosh";
    const { stdout } = await runHostCommand(shell, [
      "--quiet",
      "--eval",
      `JSON.stringify(db.getSiblingDB('${db}').getCollection('${table}').find().limit(${limit}).toArray())`,
    ]);
    let docs: unknown[] = [];
    try {
      docs = JSON.parse(stdout) as unknown[];
    } catch {
      docs = [];
    }
    const rows = docs.map((doc) => {
      const rec = doc as Record<string, unknown>;
      return {
        _id: rec._id != null ? String(rec._id) : null,
        document: JSON.stringify(doc),
      };
    });
    return {
      dbName: db,
      schema: "public",
      table,
      columns: ["_id", "document"],
      rows,
      limit,
    };
  }

  if (engine === "elasticsearch") {
    const db = ident(input.dbName);
    const table = ident(input.table);
    const { stdout } = await runHostCommand("curl", [
      "-sS",
      "-m",
      "15",
      `http://127.0.0.1:9200/${db}/_search?size=${limit}`,
    ]);
    let hits: Array<{ _id?: string; _source?: unknown }> = [];
    try {
      const parsed = JSON.parse(stdout) as { hits?: { hits?: Array<{ _id?: string; _source?: unknown }> } };
      hits = parsed.hits?.hits ?? [];
    } catch {
      hits = [];
    }
    return {
      dbName: db,
      schema: db,
      table,
      columns: ["_id", "_source"],
      rows: hits.map((hit) => ({
        _id: hit._id ?? null,
        _source: JSON.stringify(hit._source ?? {}),
      })),
      limit,
    };
  }

  throw new Error(`Preview is not available for ${engine}`);
}

export async function queryHostedSql(input: {
  engine: string;
  dbName: string;
  sql: string;
  dryRun: boolean;
}) {
  const engine = input.engine || "mysql";
  const sql = input.sql.trim();
  if (!sql) throw new Error("SQL is empty");
  if (input.dryRun) {
    return { command: "SQL", columns: [] as string[], rows: [] as Record<string, unknown>[] };
  }

  if (engine === "mysql" || engine === "mariadb") {
    const parsed = parseMysqlTsv(await mysqlQuery(sql, ident(input.dbName)));
    return { command: sql.split(/\s+/)[0]?.toUpperCase() || "SQL", ...parsed };
  }

  if (engine === "sqlite") {
    const file = sqliteFilePath(input.dbName);
    const sqlite = (await whichBin("sqlite3")) || "sqlite3";
    const { stdout } = await runHostCommand(sqlite, [
      "-header",
      "-separator",
      "\t",
      file,
      sql,
    ]);
    const parsed = parseMysqlTsv(stdout);
    return { command: "SQL", ...parsed };
  }

  if (engine === "clickhouse") {
    const db = ident(input.dbName);
    const cli = (await whichBin("clickhouse-client")) || "clickhouse-client";
    const { stdout } = await runHostCommand(cli, [
      "-q",
      `USE ${db}; ${sql} FORMAT TabSeparatedWithNames`,
    ]);
    const parsed = parseMysqlTsv(stdout);
    return { command: "SQL", ...parsed };
  }

  throw new Error(`SQL editor is not available for ${engine}`);
}
