import { NextResponse } from "next/server";
import { authFailureResponse, requireAdminUser } from "@/lib/auth";
import { requireAgentApiKey } from "@/lib/secrets";
import { runScheduledSecurityAlerts } from "@/lib/services/security-alerts";
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

/** Minutely systemd timer — new public ports and root SSH logins. */
export async function POST(request: Request) {
  try {
    await authorizeWorker(request);
    const snapshot = await runScheduledSecurityAlerts();
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (error) {
    return (
      authFailureResponse(error) ??
      NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Security alert check failed",
        },
        { status: 500 }
      )
    );
  }
}
