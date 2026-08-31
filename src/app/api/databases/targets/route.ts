import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { listHostingTargets } from "@/lib/hosting-targets";

export async function GET() {
  try {
    const user = await requireSessionUser("databases");
    const targets = await listHostingTargets(
      { id: user.id, role: user.role },
      { excludeMailSubdomains: true, feature: "databases" }
    );
    return NextResponse.json({ targets });
  } catch (error) {
    return authFailureResponse(error);
  }
}
