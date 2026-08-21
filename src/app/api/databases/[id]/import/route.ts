import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { csrfOk } from "@/lib/csrf";
import { importPostgresDatabaseDump } from "@/lib/services/databases";

export const runtime = "nodejs";
export const maxDuration = 600;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!csrfOk(request)) {
      return NextResponse.json(
        { error: "CSRF check failed (invalid Origin)" },
        { status: 403 }
      );
    }

    const user = await requireSessionUser("databases");
    const { id } = await context.params;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Upload failed: request body was truncated. Raise the upload limit in Settings." },
        { status: 413 }
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a .sql or .dump file" }, { status: 400 });
    }

    const content = Buffer.from(await file.arrayBuffer());
    const result = await importPostgresDatabaseDump({
      id,
      userId: user.id,
      role: user.role,
      fileName: file.name,
      content,
    });
    return NextResponse.json({
      ok: true,
      dbName: result.dbName,
      message: `Imported into ${result.dbName}`,
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
          error instanceof Error ? error.message : "Failed to import database",
      },
      { status: 500 }
    );
  }
}
