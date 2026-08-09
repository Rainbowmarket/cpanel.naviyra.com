import { NextResponse } from "next/server";
import { z } from "zod";
import { applySessionCookie, requireSessionUser } from "@/lib/auth";
import { confirmTwoFactorSetup } from "@/lib/services/two-factor";

const schema = z.object({
  code: z.string().min(6).max(12),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = schema.parse(await request.json());
    const result = await confirmTwoFactorSetup(user.id, body.code);
    const response = NextResponse.json({
      ok: true,
      backupCodes: result.backupCodes,
    });
    // Re-issue session after sessionVersion bump
    return applySessionCookie(response, user.id, result.sessionVersion);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to confirm 2FA",
      },
      { status: 400 }
    );
  }
}
