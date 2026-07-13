import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fileManagerUpload } from "@/lib/services/file-manager";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const form = await request.formData();
    const targetRaw = String(form.get("target") ?? form.get("domainId") ?? "");
    const target =
      targetRaw.startsWith("d:") || targetRaw.startsWith("s:") ? targetRaw : targetRaw ? `d:${targetRaw}` : "";
    const dirPath = String(form.get("path") ?? "");
    const file = form.get("file");

    if (!target || !dirPath || !(file instanceof File)) {
      return new NextResponse("Invalid upload request.", { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const message = await fileManagerUpload(
      target,
      user.id,
      dirPath,
      file.name,
      buffer.toString("base64")
    );
    return new NextResponse(message, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new NextResponse("Not authenticated", { status: 401 });
    }
    return new NextResponse(error instanceof Error ? error.message : "Upload failed", {
      status: 500,
    });
  }
}
