import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { requireAgentApiKey } from "@/lib/secrets";
import {
  autoBlockTtlMs,
  blockIp,
  expireAutoBlocks,
  listBlockedIps,
  unblockIp,
} from "@/lib/services/security";
import { bearerTokenMatches } from "@/lib/timing-safe";

function workerToken(): string {
  const explicit = process.env.BACKUP_WORKER_TOKEN?.trim();
  if (explicit && explicit.length >= 16 && explicit !== "change-me") {
    return explicit;
  }
  return requireAgentApiKey();
}

async function authorizeExpire(request: Request): Promise<void> {
  if (bearerTokenMatches(request.headers.get("authorization"), workerToken())) {
    return;
  }
  await requireSessionUser();
}

export async function GET() {
  try {
    await requireSessionUser();
    const blocked = await listBlockedIps();
    return NextResponse.json({
      blocked,
      autoBlockTtlHours: autoBlockTtlMs() / (60 * 60 * 1000),
    });
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
    const body = await request.json().catch(() => ({}));

    // Hourly timer / manual expire pass
    if (
      body?.action === "expire_auto" ||
      request.headers.get("x-naviyra-expire") === "1"
    ) {
      await authorizeExpire(request);
      const result = await expireAutoBlocks();
      return NextResponse.json({ ok: true, ...result });
    }

    await requireSessionUser();
    const parsed = blockSchema.parse(body);
    await blockIp(parsed.ip, parsed.reason, "manual");
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
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
