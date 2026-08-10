import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser, requireSessionUser } from "@/lib/auth";
import { listSecurityEvents, logVisit, blockIp } from "@/lib/services/security";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const domainId = new URL(request.url).searchParams.get("domainId") ?? undefined;
    const events = await listSecurityEvents(user.id, domainId, 50, user.role);
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const ingestSchema = z.object({
  domainId: z.string(),
  ipAddress: z.string(),
  url: z.string(),
  method: z.string().optional(),
  userAgent: z.string().optional(),
  referrer: z.string().optional(),
  statusCode: z.number().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = ingestSchema.parse(await request.json());
    const result = await logVisit({ userId: user.id, ...body });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to log visit" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdminUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const event = await prisma.securityEvent.findFirst({
      where: {
        id,
        // Admins may block from any event; still require a real row.
        ...(user.role === "ADMIN" ? {} : { domain: { userId: user.id } }),
      },
      include: { domain: { include: { server: true } } },
    });
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await blockIp(
      event.ipAddress,
      `Blocked from event: ${event.threatType}`,
      "security_event",
      event.id,
      event.domain?.server.agentKey
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to block" },
      { status: 400 }
    );
  }
}
