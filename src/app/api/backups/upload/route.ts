import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { csrfOk } from "@/lib/csrf";
import { uploadBackupArchive } from "@/lib/services/backups";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    if (!csrfOk(request)) {
      return NextResponse.json(
        { error: "CSRF check failed (invalid Origin)" },
        { status: 403 }
      );
    }
    await requireAdminUser();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Upload was truncated. Try a smaller file or raise the panel upload limit." },
        { status: 413 }
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a .tar.gz backup file" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await uploadBackupArchive({
      fileName: file.name,
      content: buf,
    });
    return NextResponse.json({ ok: true, run: result.run }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to upload backup",
      },
      { status: 400 }
    );
  }
}
