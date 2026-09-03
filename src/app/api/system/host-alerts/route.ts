import { NextResponse } from "next/server";
import { authFailureResponse, requireAdminUser } from "@/lib/auth";
import { requireAgentApiKey } from "@/lib/secrets";
import { runScheduledHostAlerts } from "@/lib/services/host-alerts";
import { bearerTokenMatches } from "@/lib/timing-safe";

function workerToken(): string {
  const explicit = process.env.BACKUP_WORKER_TOKEN?.trim();
  if (explicit && explicit.length >= 16 && explicit !== "change-me") {
    return explicit;
  }
  return requireAgentApiKey();
}

async function authorizeWorker(request: Request): Promise<void> {
  if (bearerTokenMatches(request.headers.get("authorization"), workerToken())) {
    return;
  }
  await requireAdminUser();
}

/** Hourly systemd timer (or admin) — evaluate CPU/RAM/disk/agent alerts. */
export async function POST(request: Request) {
  try {
    await authorizeWorker(request);
    const snapshot = await runScheduledHostAlerts();
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (error) {
    return (
      authFailureResponse(error) ??
      NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Host alert check failed",
        },
        { status: 500 }
      )
    );
  }
}
