import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { blockIp, listBlockedIps, unblockIp } from "@/lib/services/security";

export async function GET() {
  try {
    await requireSessionUser();
    const blocked = await listBlockedIps();
    return NextResponse.json({ blocked });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const blockSchema = z.object({
  ip: z.string(),
  reason: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    await requireSessionUser();
    const body = blockSchema.parse(await request.json());
    await blockIp(body.ip, body.reason, "manual");
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to block IP" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSessionUser();
    const ip = new URL(request.url).searchParams.get("ip");
    if (!ip) return NextResponse.json({ error: "ip required" }, { status: 400 });
    await unblockIp(ip);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to unblock" },
      { status: 400 }
    );
  }
}
