import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getSecurityOverview } from "@/lib/services/security";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const domainId = new URL(request.url).searchParams.get("domainId") ?? undefined;
    const stats = await getSecurityOverview(user.id, domainId, user.role);
    return NextResponse.json({ stats });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
