import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { ensureDomainDkimSetup } from "@/lib/services/mail";

const schema = z.object({
  domainId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    const body = schema.parse(await request.json());
    const mailDomain = await ensureDomainDkimSetup(
      body.domainId,
      user.id,
      user.role
    );
    return NextResponse.json({ mailDomain });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "DKIM setup failed",
      },
      { status: 400 }
    );
  }
}
