import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { previewPostgresDatabaseTable } from "@/lib/services/databases";

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  table: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid table name"),
  schema: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid schema name")
    .optional()
    .default("public"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      table: url.searchParams.get("table") ?? "",
      schema: url.searchParams.get("schema") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const result = await previewPostgresDatabaseTable({
      id,
      userId: user.id,
      role: user.role,
      schema: parsed.schema,
      table: parsed.table,
      limit: parsed.limit,
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
            : "Failed to preview table rows",
      },
      { status: 500 }
    );
  }
}
