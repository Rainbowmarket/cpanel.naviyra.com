import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateMailbox,
  createMailSession,
  destroyMailSession,
  getMailSession,
} from "@/lib/mail/session";
import {
  assertLoginAllowed,
  clearLoginFailures,
  getClientIp,
  recordLoginFailure,
} from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  try {
    const body = loginSchema.parse(await request.json());

    try {
      assertLoginAllowed(ip, body.email);
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

    const result = await authenticateMailbox(body.email, body.password);
    if (!result.ok) {
      if (result.code === "invalid") {
        recordLoginFailure(ip, body.email);
      }
      return NextResponse.json(
        {
          error: result.message,
          code: result.code,
          attemptsLeft: result.attemptsLeft,
        },
        { status: result.code === "disabled" ? 403 : 401 }
      );
    }

    clearLoginFailures(ip, body.email);
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
