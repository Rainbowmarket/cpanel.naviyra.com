import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { listHostingTargets } from "@/lib/hosting-targets";

export async function GET() {
  try {
    const user = await requireAdminUser();
    const targets = await listHostingTargets(
      { id: user.id, role: user.role },
      { excludeMailSubdomains: true }
    );
    return NextResponse.json({
      success: true,
      role: user.role,
      targets,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ success: false, message: "Admin only" }, { status: 403 });
    }
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
}
