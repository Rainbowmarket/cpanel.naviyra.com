import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { beginTwoFactorSetup, getTwoFactorStatus } from "@/lib/services/two-factor";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const status = await getTwoFactorStatus(user.id);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST() {
  try {
    const user = await requireSessionUser();
    const status = await getTwoFactorStatus(user.id);
    if (status.enabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled" },
        { status: 400 }
      );
    }
    const setup = await beginTwoFactorSetup(user.id, user.email);
    return NextResponse.json(setup);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to start 2FA setup",
      },
      { status: 400 }
    );
  }
}
