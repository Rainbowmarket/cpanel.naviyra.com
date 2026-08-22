import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { downloadBackupRun } from "@/lib/services/backups";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const runId = new URL(request.url).searchParams.get("runId")?.trim() || "";
    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }
    const dump = await downloadBackupRun(runId);
    return new NextResponse(new Uint8Array(dump.content), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${dump.fileName}"`,
        "Content-Length": String(dump.content.length),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to download backup",
      },
      { status: 400 }
    );
  }
}
