import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireIngestKey } from "@/lib/secrets";
import { logVisit } from "@/lib/services/security";

function ingestKeyOk(request: Request): boolean {
  let expected: string;
  try {
    const configured = process.env.SECURITY_INGEST_KEY?.trim();
    expected =
      configured && configured.length >= 16
        ? configured
        : requireIngestKey();
  } catch {
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const key =
    header.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-ingest-key")?.trim() ||
    "";
  return key.length > 0 && key === expected;
}

const ingestSchema = z.object({
  host: z.string().min(1),
  ipAddress: z.string().min(3),
  url: z.string().min(1),
  method: z.string().optional(),
  userAgent: z.string().optional(),
  referrer: z.string().optional(),
  statusCode: z.number().optional(),
});

const batchSchema = z.object({
  events: z.array(ingestSchema).min(1).max(500),
});

async function resolveDomain(host: string) {
  const hostname = host.split(":")[0]!.toLowerCase().replace(/^www\./, "");
  // Exact domain match, or subdomain of a hosted domain
  const domain = await prisma.domain.findFirst({
    where: {
      OR: [
        { name: hostname },
        { name: hostname.replace(/^[^.]+\./, "") },
      ],
      status: "ACTIVE",
    },
  });
  if (domain && (domain.name === hostname || hostname.endsWith(`.${domain.name}`))) {
    return domain;
  }
  // Also check subdomain table
  const parts = hostname.split(".");
  if (parts.length >= 3) {
    const label = parts[0]!;
    const parent = parts.slice(1).join(".");
    const sub = await prisma.subdomain.findFirst({
      where: { name: label, domain: { name: parent, status: "ACTIVE" } },
      include: { domain: true },
    });
    if (sub) return sub.domain;
  }
  return null;
}

export async function POST(request: Request) {
  if (!ingestKeyOk(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await request.json();
    const items = Array.isArray(json?.events)
      ? batchSchema.parse(json).events
      : [ingestSchema.parse(json)];

    let logged = 0;
    let skipped = 0;
    for (const item of items) {
      const domain = await resolveDomain(item.host);
      if (!domain) {
        skipped += 1;
        continue;
      }
      await logVisit({
        userId: domain.userId,
        domainId: domain.id,
        ipAddress: item.ipAddress,
        url: item.url,
        method: item.method,
        userAgent: item.userAgent,
        referrer: item.referrer,
        statusCode: item.statusCode,
      });
      logged += 1;
    }

    return NextResponse.json({ ok: true, logged, skipped });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ingest failed" },
      { status: 500 }
    );
  }
}
