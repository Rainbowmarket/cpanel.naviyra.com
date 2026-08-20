import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { getSecurityOverview, getVisitorIngestStatus } from "@/lib/services/security";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser("security");
    const domainId = new URL(request.url).searchParams.get("domainId") ?? undefined;
    const stats = await getSecurityOverview(user.id, domainId, user.role);
    const ingest = getVisitorIngestStatus();
    return NextResponse.json({ stats, ingest });
  } catch (error) {
    return authFailureResponse(error);
  }
}
