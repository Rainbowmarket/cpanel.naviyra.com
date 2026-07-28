import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import {
  createTerminalSession,
  endTerminalSession,
  listTerminalSessions,
} from "@/lib/services/terminal";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const sessions = await listTerminalSessions(user.id);
    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = (await request.json().catch(() => ({}))) as {
      targetId?: string;
      action?: string;
      sessionId?: string;
    };

    if (body.action === "end" && body.sessionId) {
      await endTerminalSession(user.id, body.sessionId);
      return NextResponse.json({ success: true });
    }

    const session = await createTerminalSession(user, body.targetId);
    return NextResponse.json({ success: true, ...session });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to create terminal session";
    const status =
      message.includes("Select a domain") || message.includes("Invalid hosting") ? 400 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
