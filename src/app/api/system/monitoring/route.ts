import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { recordAndListMonitoring } from "@/lib/services/monitoring";

export async function GET() {
  try {
    await requireSessionUser();
    const data = await recordAndListMonitoring();
    return NextResponse.json(data);
  } catch (error) {
    return authFailureResponse(error) ?? NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load monitoring",
      },
      { status: 500 }
    );
  }
}
