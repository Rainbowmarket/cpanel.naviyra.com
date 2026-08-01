import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import {
  fileManagerList,
  fileManagerRead,
  fileManagerSession,
} from "@/lib/services/file-manager";
import { targetFromSearchParams } from "@/lib/file-manager-target";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") ?? "session";
    const target = targetFromSearchParams(searchParams);

    if (action === "session") {
      return NextResponse.json(await fileManagerSession(target, { id: user.id, role: user.role }));
    }

    if (action === "list") {
      const path = searchParams.get("path") ?? "";
      return NextResponse.json(await fileManagerList(target, { id: user.id, role: user.role }, path));
    }

    if (action === "read") {
      const path = searchParams.get("path") ?? "";
      const file = searchParams.get("file") ?? "";
      return NextResponse.json(await fileManagerRead(target, { id: user.id, role: user.role }, path, file));
    }

    return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "File manager request failed",
      },
      { status: 500 }
    );
  }
}
