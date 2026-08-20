import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { inspectPostgresDatabaseSchema } from "@/lib/services/databases";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const result = await inspectPostgresDatabaseSchema(id, user.id, user.role);
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
            : "Failed to load database schema",
      },
      { status: 500 }
    );
  }
}
