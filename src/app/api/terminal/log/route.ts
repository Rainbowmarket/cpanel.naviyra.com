import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { appendTerminalLogs, getTerminalLogs } from "@/lib/services/terminal";

export async function GET(request: Request) {
  try {
    const user = await requireAdminUser();
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json({ success: false, message: "sessionId required" }, { status: 400 });
    }
    const logs = await getTerminalLogs(user.id, sessionId);
    return NextResponse.json({ success: true, logs });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ success: false, message: "Admin only" }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdminUser();
    const body = (await request.json()) as {
      sessionId?: string;
      lines?: Array<{ at?: string; kind: "cmd" | "out" | "sys"; text: string }>;
    };
    if (!body.sessionId || !Array.isArray(body.lines)) {
      return NextResponse.json(
        { success: false, message: "sessionId and lines required" },
        { status: 400 }
      );
    }
    await appendTerminalLogs(user.id, body.sessionId, body.lines);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ success: false, message: "Admin only" }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
