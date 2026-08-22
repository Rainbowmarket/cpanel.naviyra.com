import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import {
  composeUpForSite,
  controlDockerContainer,
  getDockerLogs,
  listDockerContainers,
} from "@/lib/services/docker";

const controlSchema = z.object({
  op: z.enum(["start", "stop", "restart", "logs", "compose"]),
  id: z.string().min(1).optional(),
  kind: z.enum(["domain", "subdomain"]).optional(),
  siteId: z.string().min(1).optional(),
});

export async function GET() {
  try {
    await requireSessionUser("apps");
    const data = await listDockerContainers();
    return NextResponse.json(data);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "Forbidden")
    ) {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list containers" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("apps");
    const body = controlSchema.parse(await request.json());
    if (body.op === "compose") {
      if (!body.kind || !body.siteId) {
        return NextResponse.json({ error: "Site required" }, { status: 400 });
      }
      const data = await composeUpForSite(user, body.kind, body.siteId);
      return NextResponse.json({ ok: true, data });
    }
    if (!body.id) {
      return NextResponse.json({ error: "Container id required" }, { status: 400 });
    }
    if (body.op === "logs") {
      const data = await getDockerLogs(body.id);
      return NextResponse.json(data);
    }
    await controlDockerContainer(body.id, body.op);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "Forbidden")
    ) {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Docker action failed" },
      { status: 400 }
    );
  }
}
