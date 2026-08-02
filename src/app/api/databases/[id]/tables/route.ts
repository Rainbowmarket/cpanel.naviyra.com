import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  alterPostgresDatabaseTable,
  createPostgresDatabaseTable,
  deletePostgresDatabaseTable,
} from "@/lib/services/databases";

type RouteContext = { params: Promise<{ id: string }> };

const columnSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid column name"),
  type: z.string().min(1).max(64),
  nullable: z.boolean().optional().default(true),
  primaryKey: z.boolean().optional().default(false),
  defaultValue: z.string().max(200).nullable().optional(),
});

const createSchema = z.object({
  schema: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    .optional()
    .default("public"),
  table: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid table name"),
  columns: z.array(columnSchema).min(1).max(40),
});

const alterSchema = z
  .object({
    schema: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      .optional()
      .default("public"),
    table: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid table name"),
    newName: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid table name")
      .optional(),
    addColumns: z.array(columnSchema).max(20).optional().default([]),
    dropColumns: z
      .array(
        z
          .string()
          .min(1)
          .max(63)
          .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid column name")
      )
      .max(40)
      .optional()
      .default([]),
  })
  .refine(
    (v) =>
      Boolean(v.newName && v.newName !== v.table) ||
      (v.addColumns?.length ?? 0) > 0 ||
      (v.dropColumns?.length ?? 0) > 0,
    { message: "Provide a rename, columns to add, or columns to drop" }
  );

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const body = createSchema.parse(await request.json());
    const result = await createPostgresDatabaseTable({
      id,
      userId: user.id,
      role: user.role,
      schema: body.schema,
      table: body.table,
      columns: body.columns,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create table",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const body = alterSchema.parse(await request.json());
    const result = await alterPostgresDatabaseTable({
      id,
      userId: user.id,
      role: user.role,
      schema: body.schema,
      table: body.table,
      newName: body.newName,
      addColumns: body.addColumns,
      dropColumns: body.dropColumns,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to edit table",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const url = new URL(request.url);
    const schema = url.searchParams.get("schema") || "public";
    const table = url.searchParams.get("table");
    if (!table) {
      return NextResponse.json({ error: "Missing table" }, { status: 400 });
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      return NextResponse.json({ error: "Invalid schema" }, { status: 400 });
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      return NextResponse.json({ error: "Invalid table" }, { status: 400 });
    }
    const result = await deletePostgresDatabaseTable({
      id,
      userId: user.id,
      role: user.role,
      schema,
      table,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete table",
      },
      { status: 500 }
    );
  }
}
