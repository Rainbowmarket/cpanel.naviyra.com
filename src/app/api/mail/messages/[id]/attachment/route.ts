import { NextResponse } from "next/server";
import {
  downloadWebmailAttachment,
  parseMailFolder,
} from "@/lib/services/webmail";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const folderParam = searchParams.get("folder");
    const indexRaw = searchParams.get("index");
    const index = Number(indexRaw);

    if (!accountId || !folderParam || !Number.isInteger(index) || index < 0) {
      return NextResponse.json(
        { error: "accountId, folder, and index are required" },
        { status: 400 }
      );
    }

    const folder = parseMailFolder(folderParam);
    if (!folder) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    const file = await downloadWebmailAttachment(accountId, folder, id, index);
    const safeName = file.filename.replace(/"/g, "");
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(file.content.length),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Attachment not found",
      },
      { status: 404 }
    );
  }
}
