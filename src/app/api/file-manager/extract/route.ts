import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fileManagerExtractZip } from "@/lib/services/file-manager";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const form = await request.formData();
    const targetRaw = String(form.get("target") ?? form.get("domainId") ?? "");
    const target =
      targetRaw.startsWith("d:") || targetRaw.startsWith("s:") ? targetRaw : targetRaw ? `d:${targetRaw}` : "";
    const dirPath = String(form.get("path") ?? "");
    const fileName = String(form.get("file") ?? "");
    const removeZip = String(form.get("removeZip") ?? "") === "1";

    if (!target || !dirPath || !fileName) {
      return NextResponse.json({ success: false, message: "Invalid request" }, { status: 400 });
    }

    const message = await fileManagerExtractZip(target, { id: user.id, role: user.role }, dirPath, fileName, removeZip);
    return NextResponse.json({ success: true, message });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Extract failed" },
      { status: 500 }
    );
  }
}
