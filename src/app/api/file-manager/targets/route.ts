import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { listFileManagerTargets } from "@/lib/services/file-manager";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const targets = await listFileManagerTargets({ id: user.id, role: user.role });
    return NextResponse.json({ targets, role: user.role });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list targets" },
      { status: 500 }
    );
  }
}
