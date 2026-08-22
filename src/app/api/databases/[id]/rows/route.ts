import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { mutatePostgresDatabaseRows } from "@/lib/services/databases";

type RouteContext = { params: Promise<{ id: string }> };

const ident = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid name");

const bodySchema = z.object({
  schema: ident.optional().default("public"),
  table: ident,
  op: z.enum(["insert", "update", "delete"]),
  values: z.record(z.string(), z.unknown()).optional().default({}),
  where: z.record(z.string(), z.unknown()).optional().default({}),
  whereList: z
    .array(z.record(z.string(), z.unknown()))
    .max(100)
    .optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());
    const result = await mutatePostgresDatabaseRows({
      id,
      userId: user.id,
      role: user.role,
      schema: body.schema,
      table: body.table,
      op: body.op,
      values: body.values,
      where: body.where,
      whereList: body.whereList,
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
          error instanceof Error ? error.message : "Failed to change table data",
      },
      { status: 400 }
    );
  }
}
