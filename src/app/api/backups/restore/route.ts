import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { restoreBackupRun } from "@/lib/services/backups";

const schema = z
  .object({
    runId: z.string().min(1),
    restorePanelDb: z.boolean(),
    restoreSites: z.boolean(),
    restoreDns: z.boolean(),
    restoreMail: z.boolean(),
  })
  .refine(
    (v) => v.restorePanelDb || v.restoreSites || v.restoreDns || v.restoreMail,
    { message: "Select at least one component to restore" }
  );

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = schema.parse(await request.json());
    const result = await restoreBackupRun(body.runId, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Restore failed",
      },
      { status: 500 }
    );
  }
}
