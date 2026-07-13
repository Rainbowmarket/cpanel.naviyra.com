import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { listLiveVisitors, listVisitors } from "@/lib/services/security";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const params = new URL(request.url).searchParams;
    const domainId = params.get("domainId") ?? undefined;
    const live = params.get("live") === "1";

    if (live) {
      const rows = await listLiveVisitors(user.id, domainId);
      return NextResponse.json({ live: rows });
    }

    const visitors = await listVisitors(user.id, {
      domainId,
      search: params.get("search") ?? undefined,
      limit: Number(params.get("limit") ?? 100),
    });
    return NextResponse.json({ visitors });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
