import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { listHostingTargets } from "@/lib/hosting-targets";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const targets = await listHostingTargets(
      { id: user.id, role: user.role },
      { excludeMailSubdomains: true }
    );
    return NextResponse.json({ targets });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
