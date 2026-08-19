/**
 * One-shot agent actions for the panel local fallback (no HTTP server).
 * Reads one JSON action from stdin, prints JSON { success, data?, error? }.
 */
import {
  createPostgresDatabaseOnServer,
  deletePostgresDatabaseOnServer,
  resetPostgresPasswordOnServer,
  inspectPostgresSchemaOnServer,
  previewPostgresTableOnServer,
  createPostgresTableOnServer,
  deletePostgresTableOnServer,
  alterPostgresTableOnServer,
} from "./postgres";
import { redactPostgresError } from "./pg-bin";

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
