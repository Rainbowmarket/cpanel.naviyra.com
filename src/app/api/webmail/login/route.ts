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
    const account = await authenticateMailbox(body.email, body.password);
    if (!account) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    await createMailSession(account.id);
    return NextResponse.json({
      accountId: account.id,
      email: account.email,
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
