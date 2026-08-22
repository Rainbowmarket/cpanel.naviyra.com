import { NextResponse } from "next/server";
import { callAgent } from "@/lib/agent/client";
import { controllerAgentTarget } from "@/lib/agent/target";
import { requireSessionUser } from "@/lib/auth";
import {
  getPermissionLabel,
  getPlatformName,
  hasAdminPermission,
} from "@/lib/permissions";

function isLiveMode(): boolean {
  if (process.env.AGENT_DRY_RUN === "true") return false;
  if (process.env.AGENT_DRY_RUN === "false") return true;
  return process.platform !== "win32";
}

export async function GET() {
  try {
    await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ping = await callAgent({ action: "ping" }, await controllerAgentTarget());
  const agentOnline = ping.success;
  const agentMode = ping.via ?? (agentOnline ? "agent" : "offline");
  const isAdmin = hasAdminPermission();
  const liveMode = isLiveMode();

  const canManageServer = agentOnline && (!liveMode || isAdmin);

  let message: string;
  if (!agentOnline) {
    message = "System offline — restart the application";
  } else if (agentMode === "local") {
    message = "Built-in mode — agent not running, using local handler";
  } else if (liveMode && !isAdmin) {
    message =
      process.platform === "win32"
        ? "Restart as Administrator for full server control"
        : "Restart with sudo for full server control";
  } else if (liveMode && isAdmin) {
    message = "Running with admin — full server control enabled";
  } else {
    message = "Dry-run mode — commands are simulated (safe for testing)";
  }

  return NextResponse.json({
    platform: getPlatformName(),
    permission: getPermissionLabel(),
    isAdmin,
    agentOnline,
    agentMode,
    agentDryRun: !liveMode,
    canManageServer,
    message,
  });
}
