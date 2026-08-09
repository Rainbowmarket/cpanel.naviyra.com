import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getTwoFactorStatus } from "@/lib/services/two-factor";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const status = await getTwoFactorStatus(user.id);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
