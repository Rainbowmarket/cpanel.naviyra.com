import { NextResponse } from "next/server";
import { z } from "zod";
import { applySessionCookie } from "@/lib/auth";
import {
  clearPending2faCookie,
  getPending2faUser,
} from "@/lib/auth-2fa";
import {
  assertTotpAllowed,
  clearTotpFailures,
  getClientIp,
  recordTotpFailure,
} from "@/lib/rate-limit";
import { verifyTotpOrBackupCode } from "@/lib/services/two-factor";

const schema = z.object({
  code: z.string().min(4).max(32),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  try {
    const pending = await getPending2faUser();
    if (!pending) {
      return NextResponse.json(
        { error: "2FA challenge expired. Sign in again." },
        { status: 401 }
      );
    }

    try {
      assertTotpAllowed(ip, pending.id);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Too many failed attempts",
        },
        { status: 429 }
      );
    }

    const body = schema.parse(await request.json());

    try {
      await verifyTotpOrBackupCode(
        pending.id,
        pending.twoFactorSecret!,
        body.code
      );
    } catch (error) {
      recordTotpFailure(ip, pending.id);
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid code",
        },
        { status: 401 }
      );
    }

    clearTotpFailures(ip, pending.id);
    const response = NextResponse.json({
      user: {
        id: pending.id,
        email: pending.email,
        name: pending.name,
        role: pending.role,
      },
    });
    clearPending2faCookie(response);
    return applySessionCookie(response, pending.id, pending.sessionVersion);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "2FA failed" },
      { status: 500 }
    );
  }
}
