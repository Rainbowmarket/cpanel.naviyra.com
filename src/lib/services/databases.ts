import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { hashPassword } from "@/lib/auth";
import { resolveHostingTarget } from "@/lib/hosting-targets";

function sanitizePgLabel(raw: string): string {
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

function buildPgNames(domainName: string, label: string) {
  const safe = sanitizePgLabel(label);
  const hash = createHash("sha1")
    .update(domainName.toLowerCase())
    .digest("hex")
    .slice(0, 8);
  const dbName = `n_${hash}_${safe}`.slice(0, 63);
  return { label: safe, dbName, roleName: dbName };
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

  const names = buildPgNames(domain.name, input.label);
  const existing = await prisma.postgresDatabase.findFirst({
    where: {
      OR: [{ dbName: names.dbName }, { roleName: names.roleName }],
    },
  });
  if (existing) {
    throw new Error(`Database '${names.label}' already exists for this domain`);
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
