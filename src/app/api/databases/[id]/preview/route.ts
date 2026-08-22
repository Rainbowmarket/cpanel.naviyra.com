import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { previewPostgresDatabaseTable } from "@/lib/services/databases";

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  table: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, "Invalid table name"),
  schema: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, "Invalid schema name")
    .optional()
    .default("public"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  search: z.string().max(120).optional().default(""),
  filterColumn: z.string().max(63).optional().default(""),
  filterOp: z.enum(["contains", "equals"]).optional().default("contains"),
  filterValue: z.string().max(200).optional().default(""),
});

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      table: url.searchParams.get("table") ?? "",
      schema: url.searchParams.get("schema") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      filterColumn: url.searchParams.get("filterColumn") ?? undefined,
      filterOp: url.searchParams.get("filterOp") ?? undefined,
      filterValue: url.searchParams.get("filterValue") ?? undefined,
    });

    const result = await previewPostgresDatabaseTable({
      id,
      userId: user.id,
      role: user.role,
      schema: parsed.schema,
      table: parsed.table,
      limit: parsed.limit,
      search: parsed.search || undefined,
      filterColumn: parsed.filterColumn || undefined,
      filterOp: parsed.filterOp,
      filterValue: parsed.filterValue || undefined,
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
