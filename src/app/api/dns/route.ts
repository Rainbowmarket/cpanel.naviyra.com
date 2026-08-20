import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import {
  ensureDnsZonesForAccessibleDomains,
  getDnsNameservers,
  listDnsZones,
  retryDnsZone,
  syncDnsZone,
} from "@/lib/services/dns";
import { ensurePanelBaseDomain } from "@/lib/services/domains";

export async function GET() {
  try {
    const user = await requireSessionUser("dns");
    if (user.role === "ADMIN") {
      try {
        await ensurePanelBaseDomain(user.id);
      } catch (error) {
        console.error("ensurePanelBaseDomain failed:", error);
      }
    }
    await ensureDnsZonesForAccessibleDomains(user.id, user.role);
    const zones = await listDnsZones(user.id, user.role);
    return NextResponse.json({
      zones,
      nameservers: getDnsNameservers(),
    });
  } catch (error) {
    return authFailureResponse(error);
  }
}

const syncSchema = z.object({
  domainId: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("dns");
    const body = syncSchema.parse(await request.json());
    const zone = await syncDnsZone(body.domainId, user.id);
    return NextResponse.json({ zone }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to sync DNS zone" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser("dns");
    const { searchParams } = new URL(request.url);
    const domainId = searchParams.get("domainId");
    if (!domainId) {
      return NextResponse.json({ error: "Missing domainId" }, { status: 400 });
    }
    const zone = await retryDnsZone(domainId, user.id);
    return NextResponse.json({ zone });
  } catch {
    return NextResponse.json({ error: "Failed to retry DNS sync" }, { status: 500 });
  }
}
