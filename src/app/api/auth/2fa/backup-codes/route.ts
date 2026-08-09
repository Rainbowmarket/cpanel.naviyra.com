import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { regenerateBackupCodes } from "@/lib/services/two-factor";

const schema = z
  .object({
    password: z.string().optional(),
    totpCode: z.string().optional(),
  })
  .refine((b) => Boolean(b.password?.trim() || b.totpCode?.trim()), {
    message: "password or totpCode required",
  });

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = schema.parse(await request.json());
    const result = await regenerateBackupCodes(user.id, {
      password: body.password,
      totpCode: body.totpCode,
    });
    return NextResponse.json({ backupCodes: result.backupCodes });
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
          error instanceof Error
            ? error.message
            : "Failed to regenerate backup codes",
      },
      { status: 400 }
    );
  }
}
