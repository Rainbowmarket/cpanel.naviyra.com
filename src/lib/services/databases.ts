import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { hashPassword } from "@/lib/auth";
import { resolveHostingTarget } from "@/lib/hosting-targets";

const RESERVED_PG_NAMES = new Set([
  "postgres",
  "template0",
  "template1",
  "template_postgres",
]);

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
}) {
  const user = encodeURIComponent(input.user);
  const db = encodeURIComponent(input.database);
  if (input.password !== undefined) {
    const pass = encodeURIComponent(input.password);
    return `postgresql://${user}:${pass}@${input.host}:${input.port}/${db}`;
  }
  return `postgresql://${user}@${input.host}:${input.port}/${db}`;
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
  role?: "ADMIN" | "RESELLER" | "USER";
  label: string;
  password: string;
}) {
  if (!input.password || input.password.length < 8) {
    throw new Error("Database password must be at least 8 characters");
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

  const existsOnServer = await callAgent<{ exists?: boolean }>(
    { action: "postgres_database_exists", dbName: names.dbName },
    domain.server.agentKey
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

  const passwordHash = await hashPassword(input.password);

  const agentResult = await callAgent(
    {
      action: "create_postgres_database",
      dbName: names.dbName,
      roleName: names.roleName,
      password: input.password,
    },
    domain.server.agentKey
  );

  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to provision PostgreSQL database on server"
    );
  }

  const record = await prisma.postgresDatabase.create({
    data: {
      label: names.label,
      dbName: names.dbName,
      roleName: names.roleName,
      passwordHash,
      domainId: domain.id,
    },
    include: {
      domain: { select: { id: true, name: true } },
    },
  });

  const connection = postgresConnectionInfo();
  return {
    database: record,
    connection: {
      ...connection,
      database: record.dbName,
      user: record.roleName,
      password: input.password,
      uri: buildConnectionUri({
        ...connection,
        database: record.dbName,
        user: record.roleName,
        password: input.password,
      }),
    },
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

  const agentResult = await callAgent(
    {
      action: "reset_postgres_password",
      roleName: record.roleName,
      password: input.password,
    },
    record.domain.server.agentKey
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to reset PostgreSQL password on server"
    );
  }

  const passwordHash = await hashPassword(input.password);
  const updated = await prisma.postgresDatabase.update({
    where: { id: record.id },
    data: { passwordHash },
    include: {
      domain: { select: { id: true, name: true } },
    },
  });

  const connection = postgresConnectionInfo();
  return {
    database: updated,
    connection: {
      ...connection,
      database: updated.dbName,
      user: updated.roleName,
      password: input.password,
      uri: buildConnectionUri({
        ...connection,
        database: updated.dbName,
        user: updated.roleName,
        password: input.password,
      }),
    },
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

  const agentResult = await callAgent(
    {
      action: "delete_postgres_database",
      dbName: record.dbName,
      roleName: record.roleName,
    },
    record.domain.server.agentKey
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to remove PostgreSQL database on server"
    );
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
          server: { select: { agentKey: true } },
        },
      },
    },
  });

  const agentResult = await callAgent(
    {
      action: "inspect_postgres_schema",
      dbName: record.dbName,
    },
    record.domain.server.agentKey
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to inspect PostgreSQL schema on server"
    );
  }

  const data = (agentResult.data ?? {}) as {
    tables?: unknown[];
  };

  return {
    database: {
      id: record.id,
      label: record.label,
      dbName: record.dbName,
      roleName: record.roleName,
      domain: { id: record.domain.id, name: record.domain.name },
    },
    tables: data.tables ?? [],
  };
}

export async function previewPostgresDatabaseTable(input: {
  id: string;
  userId: string;
  role?: string;
  schema?: string;
  table: string;
  limit?: number;
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          server: { select: { agentKey: true } },
        },
      },
    },
  });

  const agentResult = await callAgent(
    {
      action: "preview_postgres_table",
      dbName: record.dbName,
      schema: input.schema || "public",
      table: input.table,
      limit: input.limit,
    },
    record.domain.server.agentKey
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
          server: { select: { agentKey: true } },
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
    record.domain.server.agentKey
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
          server: { select: { agentKey: true } },
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
    record.domain.server.agentKey
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
          server: { select: { agentKey: true } },
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
    record.domain.server.agentKey
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
}) {
  const record = await prisma.postgresDatabase.findFirstOrThrow({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { domain: { userId: input.userId } }),
    },
    include: {
      domain: {
        select: {
          server: { select: { agentKey: true } },
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
    },
    record.domain.server.agentKey
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
    record.domain.server.agentKey
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
    record.domain.server.agentKey
  );
  if (!agentResult.success) {
    throw new Error(
      agentResult.error ?? "Failed to import PostgreSQL dump"
    );
  }
  return { dbName: record.dbName };
}
