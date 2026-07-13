import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fileManagerDownloadPath } from "@/lib/services/file-manager";
import { targetFromSearchParams } from "@/lib/file-manager-target";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const target = targetFromSearchParams(searchParams);
    const dirPath = searchParams.get("p") ?? "";
    const fileName = searchParams.get("file") ?? "";

    if (!dirPath || !fileName) {
      return NextResponse.json({ success: false, message: "Missing parameters" }, { status: 400 });
    }

    const file = await fileManagerDownloadPath(target, user.id, dirPath, fileName);
    const body = Buffer.from(file.contentBase64, "base64");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Length": String(file.size),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Download failed" },
      { status: 500 }
    );
  }
}
