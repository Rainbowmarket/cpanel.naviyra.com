import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { ensureMailHostSetup } from "@/lib/services/mail";

const schema = z.object({
  domainId: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = schema.parse(await request.json());
    const result = await ensureMailHostSetup(body.domainId, user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mail host setup failed" },
      { status: 500 }
    );
  }
}
