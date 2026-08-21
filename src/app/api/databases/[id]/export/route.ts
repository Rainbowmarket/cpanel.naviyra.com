import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { exportPostgresDatabaseDump } from "@/lib/services/databases";

export const runtime = "nodejs";
export const maxDuration = 600;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser("databases");
    const { id } = await context.params;
    const format =
      new URL(request.url).searchParams.get("format") === "custom"
        ? "custom"
        : "sql";
    const dump = await exportPostgresDatabaseDump({
      id,
      userId: user.id,
      role: user.role,
      format,
    });
    const body = Buffer.from(dump.contentBase64, "base64");
    const type =
      format === "custom"
        ? "application/octet-stream"
        : "application/sql; charset=utf-8";
    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${dump.fileName}"`,
        "Content-Length": String(body.length),
      },
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
          error instanceof Error ? error.message : "Failed to export database",
      },
      { status: 500 }
    );
  }
}
