import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPasswordWithToken } from "@/lib/services/password-reset";

const schema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    await resetPasswordWithToken(body.token, body.password);
    return NextResponse.json({
      ok: true,
      message: "Password updated. You can sign in now.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not reset password",
      },
      { status: 400 }
    );
  }
}
