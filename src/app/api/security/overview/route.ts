import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { getSecurityOverview, getVisitorIngestStatus } from "@/lib/services/security";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const domainId = new URL(request.url).searchParams.get("domainId") ?? undefined;
    const stats = await getSecurityOverview(user.id, domainId, user.role);
    const ingest = getVisitorIngestStatus();
    return NextResponse.json({ stats, ingest });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
