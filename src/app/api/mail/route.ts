import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  createMailAccount,
  deleteMailAccount,
  listMailAccounts,
  resetMailPassword,
  setMailAccountActive,
} from "@/lib/services/mail";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const domainId = new URL(request.url).searchParams.get("domainId");
    const mail = await listMailAccounts(user.id, domainId);
    return NextResponse.json(mail);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const createSchema = z.object({
  domainId: z.string(),
  localPart: z.string().min(1),
  password: z.string().min(8),
  quotaMb: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = createSchema.parse(await request.json());
    const account = await createMailAccount({ ...body, userId: user.id });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create mail account" }, { status: 500 });
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reset_password"),
    password: z.string().min(8),
  }),
  z.object({
    action: z.literal("toggle_active"),
    isActive: z.boolean(),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const body = patchSchema.parse(await request.json());

    const account =
      body.action === "reset_password"
        ? await resetMailPassword(id, user.id, body.password)
        : await setMailAccountActive(id, user.id, body.isActive);

    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update mail account" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteMailAccount(id, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete mail account" }, { status: 500 });
  }
}
