import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { createPostgresDatabaseTable } from "@/lib/services/databases";

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

const bodySchema = z.object({
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

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());
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
