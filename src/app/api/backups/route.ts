import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { requireAgentApiKey } from "@/lib/secrets";
import {
  deleteBackupRun,
  getOrCreateBackupConfig,
  listBackupRuns,
  runBackupNow,
  updateBackupConfig,
} from "@/lib/services/backups";

function workerToken(): string {
  const explicit = process.env.BACKUP_WORKER_TOKEN?.trim();
  if (explicit && explicit.length >= 16 && explicit !== "change-me") {
    return explicit;
  }
  return requireAgentApiKey();
}

async function authorizeBackupRun(request: Request): Promise<"admin" | "worker"> {
  const auth = request.headers.get("authorization") ?? "";
  if (auth === `Bearer ${workerToken()}`) return "worker";
  await requireAdminUser();
  return "admin";
}

export async function GET() {
  try {
    await requireAdminUser();
    const [config, runs] = await Promise.all([
      getOrCreateBackupConfig(),
      listBackupRuns(25),
    ]);
    return NextResponse.json({ config, runs });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: z
    .enum(["EVERY_6H", "DAILY_02", "DAILY_03", "WEEKLY_SUN"])
    .optional(),
  retainCount: z.number().int().min(1).max(60).optional(),
  includePanelDb: z.boolean().optional(),
  includeSites: z.boolean().optional(),
  includeDns: z.boolean().optional(),
  includeMail: z.boolean().optional(),
  backupRoot: z.string().min(1).optional(),
});

export async function PATCH(request: Request) {
  try {
    await requireAdminUser();
    const body = patchSchema.parse(await request.json());
    const config = await updateBackupConfig(body);
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to update backup config" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const via = await authorizeBackupRun(request);
    const source = via === "worker" ? "timer" : "manual";
    const result = await runBackupNow(source);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Backup failed",
      },
      { status: 500 }
    );
  }
}

const deleteSchema = z.object({
  runId: z.string().min(1),
});

export async function DELETE(request: Request) {
  try {
    await requireAdminUser();
    const body = deleteSchema.parse(await request.json());
    const result = await deleteBackupRun(body.runId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Delete failed",
      },
      { status: 500 }
    );
  }
}
