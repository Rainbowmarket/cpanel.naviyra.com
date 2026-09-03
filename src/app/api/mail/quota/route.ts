import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import {
  getMailAccountUsage,
  updateMailAccountQuota,
} from "@/lib/services/mail";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const usage = await getMailAccountUsage(id, user.id, user.role);
    return NextResponse.json({ usage });
  } catch (error) {
    return authFailureResponse(error);
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  quotaMb: z.number().int().positive().max(1024 * 1024),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    const body = patchSchema.parse(await request.json());
    const account = await updateMailAccountQuota(
      body.id,
      user.id,
      body.quotaMb,
      user.role
    );
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Quota update failed",
      },
      { status: 400 }
    );
  }
}
