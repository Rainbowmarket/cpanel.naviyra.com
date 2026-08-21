import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { getDnsZoneApex } from "@/lib/base-domain";
import {
  createDomain,
  deleteDomain,
  listDomains,
  retryDomain,
} from "@/lib/services/domains";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireSessionUser("domains");
    const domains = await listDomains(user.id, {
      ensurePanel: user.role === "ADMIN",
      role: user.role,
    });
    return NextResponse.json({
      domains,
      panelBaseDomain: getDnsZoneApex(),
      role: user.role,
    });
  } catch (error) {
    return authFailureResponse(error);
  }
}

const DOMAIN_NAME_MESSAGE =
  "Enter a full domain with an extension like .com, .uk, or .in (e.g. example.com)";

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, DOMAIN_NAME_MESSAGE)
    .max(253)
    .regex(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
      DOMAIN_NAME_MESSAGE
    ),
  serverId: z.string(),
  phpEnabled: z.boolean().optional(),
  appType: z.enum(["STATIC", "PHP", "PYTHON", "GO", "NODE"]).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("domains");
    const body = createSchema.parse(await request.json());
    const domain = await createDomain({
      name: body.name,
      serverId: body.serverId,
      phpEnabled: body.phpEnabled,
      appType: body.appType,
      userId: user.id,
    });
    return NextResponse.json({ domain }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const flat = error.flatten();
      const message =
        flat.formErrors[0] ||
        Object.values(flat.fieldErrors).flat()[0] ||
        DOMAIN_NAME_MESSAGE;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create domain",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser("domains");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteDomain(id, { id: user.id, role: user.role });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete domain" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser("domains");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const domain = await retryDomain(id, { id: user.id, role: user.role });
    return NextResponse.json({ domain });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to retry domain" }, { status: 500 });
  }
}

// List available servers for domain creation (authenticated)
export async function OPTIONS() {
  try {
    await requireSessionUser("domains");
  } catch (error) {
    return authFailureResponse(error);
  }
  const servers = await prisma.server.findMany({
    where: { isActive: true },
    select: { id: true, name: true, hostname: true },
  });
  return NextResponse.json({ servers });
}
