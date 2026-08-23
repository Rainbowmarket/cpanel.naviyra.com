import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireAdminUser } from "@/lib/auth";
import {
  controlPanelHostService,
  installPanelHostService,
  listPanelHostServices,
} from "@/lib/services/host-services";

export async function GET() {
  try {
    await requireAdminUser();
    const data = await listPanelHostServices();
    return NextResponse.json(data);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "Forbidden")
    ) {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list services" },
      { status: 500 }
    );
  }
}

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  op: z.enum(["start", "stop", "restart", "install"]),
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const { id, op } = bodySchema.parse(await request.json());
    const service =
      op === "install"
        ? await installPanelHostService(id)
        : await controlPanelHostService(id, op);
    return NextResponse.json({ ok: true, service });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid service control request" }, { status: 400 });
    }
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "Forbidden")
    ) {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Service control failed" },
      { status: 400 }
    );
  }
}
