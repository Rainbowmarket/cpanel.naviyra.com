import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { queryPostgresDatabaseSql } from "@/lib/services/databases";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  sql: z.string().min(1).max(8000),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const body = bodySchema.parse(await request.json());
    const result = await queryPostgresDatabaseSql({
      id,
      userId: user.id,
      role: user.role,
      sql: body.sql,
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
        error: error instanceof Error ? error.message : "Failed to run SQL",
      },
      { status: 400 }
    );
  }
}
