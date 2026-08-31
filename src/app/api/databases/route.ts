import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import {
  createPostgresDatabase,
  deletePostgresDatabase,
  listPostgresDatabases,
  listInstalledDbEngines,
  postgresConnectionInfo,
  resetPostgresDatabasePassword,
  connectionForEngine,
} from "@/lib/services/databases";

function connectionForList(db: { dbName: string; roleName: string; engine?: string }) {
  return connectionForEngine(db.engine || "postgres", db);
}

export async function GET() {
  try {
    const user = await requireSessionUser("databases");
    const [databases, engines] = await Promise.all([
      listPostgresDatabases(user.id, user.role),
      listInstalledDbEngines(user.id, user.role),
    ]);
    return NextResponse.json({
      databases: databases.map((row) => {
        const { passwordHash: _h, passwordEnc, ...db } = row;
        return {
          ...db,
          connection: connectionForList(db),
          hasPasswordEnc: Boolean(passwordEnc),
        };
      }),
      engines,
      connectionDefaults: postgresConnectionInfo(),
    });
  } catch (error) {
    return authFailureResponse(error);
  }
}

const createSchema = z.object({
  target: z.string().min(1),
  engine: z.string().min(1).optional(),
  label: z
    .string()
    .min(1)
    .max(63)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*$/,
      "Name must start with a letter and use letters, digits, or _"
    ),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("databases");
    const body = createSchema.parse(await request.json());
    const result = await createPostgresDatabase({
      ...body,
      userId: user.id,
      role: user.role,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to create database";
    const exists = /already exists/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: exists ? 409 : 500 }
    );
  }
}

const resetSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(8),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser("databases");
    const body = resetSchema.parse(await request.json());
    const result = await resetPostgresDatabasePassword({
      id: body.id,
      password: body.password,
      userId: user.id,
      role: user.role,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to reset database password",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser("databases");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deletePostgresDatabase(id, user.id, user.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete database",
      },
      { status: 500 }
    );
  }
}
