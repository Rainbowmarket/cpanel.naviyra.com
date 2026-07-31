import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/services/password-reset";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    try {
      await requestPasswordReset(body.email);
    } catch (err) {
      // Log server-side; still return generic success to the client
      console.error("[forgot-password]", err);
      return NextResponse.json(
        {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Could not send reset email. Check mail server configuration.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      message:
        "If an account exists for that email, a reset link has been sent. Check your inbox.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
