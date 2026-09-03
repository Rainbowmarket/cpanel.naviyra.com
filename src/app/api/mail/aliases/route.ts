import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  createMailAlias,
  deleteMailAlias,
} from "@/lib/services/mail";

const createSchema = z.object({
  domainId: z.string().min(1),
  localPart: z.string().min(1).max(64),
  forwardTo: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    const body = createSchema.parse(await request.json());
    const alias = await createMailAlias({
      ...body,
      userId: user.id,
      role: user.role,
    });
    return NextResponse.json({ alias }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create alias",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteMailAlias(id, user.id, user.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete alias",
      },
      { status: 400 }
    );
  }
}
