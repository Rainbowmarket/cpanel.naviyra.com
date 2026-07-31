import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateMailbox,
  createMailSession,
  destroyMailSession,
  getMailSession,
} from "@/lib/mail/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json());
    const result = await authenticateMailbox(body.email, body.password);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.message,
          code: result.code,
          attemptsLeft: result.attemptsLeft,
        },
        { status: result.code === "disabled" ? 403 : 401 }
      );
    }

    await createMailSession(result.id);
    return NextResponse.json({
      accountId: result.id,
      email: result.email,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid login data" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Login failed" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  await destroyMailSession();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getMailSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    accountId: session.accountId,
    email: session.email,
  });
}
