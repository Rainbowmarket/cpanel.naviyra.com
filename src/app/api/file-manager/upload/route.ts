import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { csrfOk } from "@/lib/csrf";
import { fileManagerUpload } from "@/lib/services/file-manager";

export const runtime = "nodejs";
/** Large ZIP uploads (extract on agent can take several minutes). */
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    if (!csrfOk(request)) {
      return new NextResponse("CSRF check failed (invalid Origin)", { status: 403 });
    }

    const user = await requireSessionUser();

    let form: FormData;
    try {
      form = await request.formData();
    } catch (err) {
      const cause =
        err instanceof Error && "cause" in err && err.cause instanceof Error
          ? err.cause.message
          : "";
      return new NextResponse(
        "Upload failed: request body was truncated or incomplete. " +
          "Files over ~10MB require the panel body-size fix (redeploy). " +
          (cause ? `(${cause})` : "Try a smaller file or refresh and retry."),
        { status: 413 }
      );
    }

    const targetRaw = String(form.get("target") ?? form.get("domainId") ?? "");
    const target =
      targetRaw.startsWith("d:") || targetRaw.startsWith("s:")
        ? targetRaw
        : targetRaw
          ? `d:${targetRaw}`
          : "";
    const dirPath = String(form.get("path") ?? "");
    const file = form.get("file");

    if (!target || !dirPath || !(file instanceof File)) {
      return new NextResponse("Invalid upload request.", { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const message = await fileManagerUpload(
      target,
      { id: user.id, role: user.role },
      dirPath,
      file.name,
      buffer
    );
    return new NextResponse(message, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new NextResponse("Not authenticated", { status: 401 });
    }
    return new NextResponse(
      error instanceof Error ? error.message : "Upload failed",
      { status: 500 }
    );
  }
}
