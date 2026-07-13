import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { addWhitelist, listWhitelist, removeWhitelist } from "@/lib/services/security";

export async function GET() {
  try {
    await requireSessionUser();
    const whitelist = await listWhitelist();
    return NextResponse.json({ whitelist });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const schema = z.object({
  ip: z.string(),
  label: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    await requireSessionUser();
    const body = schema.parse(await request.json());
    const entry = await addWhitelist(body.ip, body.label);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add IP" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSessionUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await removeWhitelist(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
}
