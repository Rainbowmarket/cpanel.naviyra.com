import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  configureSiteApp,
  controlSiteApp,
} from "@/lib/services/apps";

const configSchema = z.object({
  kind: z.enum(["domain", "subdomain"]),
  id: z.string().min(1),
  appType: z.enum(["STATIC", "PHP", "PYTHON", "GO", "NODE"]),
  startCommand: z.string().optional(),
  appStartupFile: z.string().nullable().optional(),
  appWorkingDir: z.string().optional(),
  appEnv: z.string().nullable().optional(),
  appMode: z.enum(["development", "production"]).optional(),
});

const controlSchema = z.object({
  kind: z.enum(["domain", "subdomain"]),
  id: z.string().min(1),
  op: z.enum(["start", "stop", "restart", "status"]),
});

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as "domain" | "subdomain";
    const id = url.searchParams.get("id") ?? "";
    if (!kind || !id) {
      return NextResponse.json({ error: "kind and id required" }, { status: 400 });
    }
    const site = await controlSiteApp(kind, id, user.id, "status");
    return NextResponse.json({ site });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = configSchema.parse(await request.json());
    const site = await configureSiteApp(body.kind, body.id, user.id, {
      appType: body.appType,
      startCommand: body.startCommand,
      appStartupFile: body.appStartupFile,
      appWorkingDir: body.appWorkingDir,
      appEnv: body.appEnv,
      appMode: body.appMode,
    });
    return NextResponse.json({ site });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = controlSchema.parse(await request.json());
    const site = await controlSiteApp(body.kind, body.id, user.id, body.op);
    return NextResponse.json({ site });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 400 }
    );
  }
}
