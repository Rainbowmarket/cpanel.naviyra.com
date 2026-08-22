import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { reassignPostgresDatabaseOwnership } from "@/lib/services/databases";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const result = await reassignPostgresDatabaseOwnership({
      id,
      userId: user.id,
      role: user.role,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Tables in public now belong to ${result.roleName}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fix table ownership",
      },
      { status: 500 }
    );
  }
}
