import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { collectResourceReport } from "@/lib/system/resources";

export async function GET() {
  try {
    await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await collectResourceReport();
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read resources",
      },
      { status: 500 }
    );
  }
}
