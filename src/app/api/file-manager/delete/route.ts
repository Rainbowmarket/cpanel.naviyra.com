import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fileManagerDelete } from "@/lib/services/file-manager";
import { targetFromSearchParams } from "@/lib/file-manager-target";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const target = targetFromSearchParams(searchParams);
    const action = searchParams.get("action");
    const targetPath = searchParams.get("p") ?? "";

    if (!targetPath) {
      return new NextResponse("Invalid request", { status: 400 });
    }

    const message = await fileManagerDelete(
      target,
      user.id,
      targetPath,
      action === "deleteFile"
    );
    return new NextResponse(message, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new NextResponse("Not authenticated", { status: 401 });
    }
    return new NextResponse(error instanceof Error ? error.message : "Delete failed", {
      status: 500,
    });
  }
}
