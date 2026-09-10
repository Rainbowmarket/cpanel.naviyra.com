import { NextResponse } from "next/server";
import {
  applySessionCookie,
  authFailureResponse,
  requireSessionUser,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SESSION_IDLE_SECONDS } from "@/lib/session-timeout";

/** Slide the panel session cookie while the user is actively using the UI. */
export async function POST() {
  try {
    const user = await requireSessionUser();
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { sessionVersion: true },
    });
    if (!row) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const response = NextResponse.json({
      ok: true,
      idleSeconds: SESSION_IDLE_SECONDS,
    });
    return applySessionCookie(response, user.id, row.sessionVersion);
  } catch (error) {
    return (
      authFailureResponse(error) ??
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
}
