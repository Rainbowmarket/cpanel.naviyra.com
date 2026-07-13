import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { createDomain, deleteDomain, listDomains, retryDomain } from "@/lib/services/domains";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const domains = await listDomains(user.id);
    return NextResponse.json({ domains });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const createSchema = z.object({
  name: z.string().min(3),
  serverId: z.string(),
  documentRoot: z.string().optional(),
  phpEnabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = createSchema.parse(await request.json());
    const domain = await createDomain({ ...body, userId: user.id });
    return NextResponse.json({ domain }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to create domain" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteDomain(id, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete domain" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const domain = await retryDomain(id, user.id);
    return NextResponse.json({ domain });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to retry domain" }, { status: 500 });
  }
}

// List available servers for domain creation
export async function OPTIONS() {
  const servers = await prisma.server.findMany({
    where: { isActive: true },
    select: { id: true, name: true, hostname: true },
  });
  return NextResponse.json({ servers });
}
