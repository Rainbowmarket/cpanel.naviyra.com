import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireAdminUser } from "@/lib/auth";
import {
  invokeServerPlugin,
  listServerPlugins,
} from "@/lib/services/plugins";

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const serverId = url.searchParams.get("serverId") || "";
    if (!serverId) {
      return NextResponse.json({ error: "serverId is required" }, { status: 400 });
    }
    const refresh = url.searchParams.get("refresh") !== "0";
    const plugins = await listServerPlugins(serverId, refresh);
    return NextResponse.json({ plugins });
  } catch (error) {
    return (
      authFailureResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to list plugins" },
        { status: 400 }
      )
    );
  }
}

const invokeSchema = z.object({
  serverId: z.string().min(1),
  pluginId: z.string().min(1),
  op: z.enum([
    "install",
    "configure",
    "health",
    "create",
    "delete",
    "backup",
    "restore",
    "inspect",
    "preview",
    "query",
  ]),
  params: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = invokeSchema.parse(await request.json());
    const data = await invokeServerPlugin(body);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return (
      authFailureResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Plugin action failed" },
        { status: 400 }
      )
    );
  }
}
