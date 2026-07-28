import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { listHostingTargets } from "@/lib/hosting-targets";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const targets = await listHostingTargets(user.id, {
      excludeMailSubdomains: true,
    });
    return NextResponse.json({
      success: true,
      role: user.role,
      targets,
    });
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
}
