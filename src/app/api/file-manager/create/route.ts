import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fileManagerCreate } from "@/lib/services/file-manager";
import { targetFromSearchParams } from "@/lib/file-manager-target";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const target = targetFromSearchParams(searchParams);
    const action = searchParams.get("action");
    const dirPath = searchParams.get("p") ?? "";
    const name = searchParams.get("name") ?? "";

    if (action !== "createFolder" && action !== "createFile") {
      return new NextResponse("Invalid request", { status: 400 });
    }

    const message = await fileManagerCreate(target, { id: user.id, role: user.role }, dirPath, name, action);
    return new NextResponse(message, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new NextResponse("Not authenticated", { status: 401 });
    }
    return new NextResponse(error instanceof Error ? error.message : "Create failed", {
      status: 500,
    });
  }
}
