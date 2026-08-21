import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import {
  applyStoredUploadLimitIfNeeded,
  getOrCreatePanelServerConfig,
  MAX_MAX_UPLOAD_MB,
  MIN_MAX_UPLOAD_MB,
  updateMaxUploadMb,
} from "@/lib/services/panel-settings";

export async function GET() {
  try {
    await requireAdminUser();
    let config = await getOrCreatePanelServerConfig();
    if (!config.nginxApplied && !config.lastError) {
      config = await applyStoredUploadLimitIfNeeded();
    }
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const patchSchema = z.object({
  maxUploadMb: z.number().int().min(MIN_MAX_UPLOAD_MB).max(MAX_MAX_UPLOAD_MB),
});

export async function PATCH(request: Request) {
  try {
    await requireAdminUser();
    const body = patchSchema.parse(await request.json());
    const config = await updateMaxUploadMb(body.maxUploadMb);
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
