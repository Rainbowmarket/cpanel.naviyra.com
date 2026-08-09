import { NextResponse } from "next/server";
import { z } from "zod";
import { applySessionCookie, requireSessionUser } from "@/lib/auth";
import { disableTwoFactor } from "@/lib/services/two-factor";

const schema = z.object({
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = schema.parse(await request.json());
    const result = await disableTwoFactor(user.id, body.password);
    const response = NextResponse.json({ ok: true });
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
          error instanceof Error ? error.message : "Failed to disable 2FA",
      },
      { status: 400 }
    );
  }
}
