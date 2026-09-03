import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { setMailCatchAll } from "@/lib/services/mail";

const schema = z.object({
  domainId: z.string().min(1),
  forwardTo: z.union([z.string().email(), z.null()]),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    const body = schema.parse(await request.json());
    const mailDomain = await setMailCatchAll({
      domainId: body.domainId,
      forwardTo: body.forwardTo,
      userId: user.id,
      role: user.role,
    });
    return NextResponse.json({ mailDomain });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save catch-all",
      },
      { status: 400 }
    );
  }
}
