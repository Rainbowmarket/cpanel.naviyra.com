import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { runServerSpeedTest } from "@/lib/system/speed-test";

export const runtime = "nodejs";
/** Download + upload probes can take ~20–30s. */
export const maxDuration = 60;

const bodySchema = z.object({
  download: z.boolean().optional().default(true),
  upload: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();

    let download = true;
    let upload = true;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const raw = await request.json().catch(() => ({}));
      const parsed = bodySchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      }
      download = parsed.data.download;
      upload = parsed.data.upload;
    }

    if (!download && !upload) {
      return NextResponse.json(
        { error: "Select at least one of download or upload" },
        { status: 400 }
      );
    }

    const report = await runServerSpeedTest({ download, upload });
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Speed test failed",
      },
      { status: 500 }
    );
  }
}
