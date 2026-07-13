import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  getDnsNameservers,
  listDnsZones,
  retryDnsZone,
  syncDnsZone,
} from "@/lib/services/dns";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const zones = await listDnsZones(user.id);
    return NextResponse.json({
      zones,
      nameservers: getDnsNameservers(),
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const syncSchema = z.object({
  domainId: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
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
    const user = await requireSessionUser();
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
