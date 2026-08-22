import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireAdminUser } from "@/lib/auth";
import {
  createFleetServer,
  deleteFleetServer,
  listFleetServers,
  pingFleetServer,
  publicServerRow,
  updateFleetServer,
} from "@/lib/services/servers";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  hostname: z.string().min(1).max(253),
  ipAddress: z.string().min(1).max(64),
  agentUrl: z.string().max(300).optional().or(z.literal("")),
  agentKey: z.string().max(200).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

const patchSchema = createSchema.partial().extend({
  id: z.string().min(1),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireAdminUser();
    const servers = await listFleetServers();
    return NextResponse.json({
      servers: servers.map(publicServerRow),
    });
  } catch (error) {
    return authFailureResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = await request.json();
    if (body?.op === "ping" && typeof body.id === "string") {
      const data = await pingFleetServer(body.id);
      return NextResponse.json({ ok: true, data });
    }
    const parsed = createSchema.parse(body);
    const server = await createFleetServer({
      ...parsed,
      agentUrl: parsed.agentUrl || undefined,
      agentKey: parsed.agentKey || undefined,
      notes: parsed.notes || undefined,
    });
    const full = await listFleetServers();
    const row = full.find((s) => s.id === server.id);
    return NextResponse.json(
      { server: row ? publicServerRow(row) : { id: server.id } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return authFailureResponse(error) ?? NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save server" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminUser();
    const body = patchSchema.parse(await request.json());
    await updateFleetServer(body.id, {
      name: body.name,
      hostname: body.hostname,
      ipAddress: body.ipAddress,
      agentUrl: body.agentUrl === "" ? null : body.agentUrl,
      agentKey: body.agentKey || undefined,
      notes: body.notes,
      isActive: body.isActive,
    });
    const servers = await listFleetServers();
    const row = servers.find((s) => s.id === body.id);
    return NextResponse.json({ server: row ? publicServerRow(row) : null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return authFailureResponse(error) ?? NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update server" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    await deleteFleetServer(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authFailureResponse(error) ?? NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete server" },
      { status: 400 }
    );
  }
}
