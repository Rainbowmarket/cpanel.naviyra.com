import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser, requireSessionUser } from "@/lib/auth";
import { isValidIpAddress } from "@/lib/ip";
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
  ip: z
    .string()
    .min(1)
    .refine((v) => isValidIpAddress(v), "Must be a valid IPv4 or IPv6 address"),
  label: z
    .string()
    .max(120)
    .refine((v) => !/[\r\n\0]/.test(v), "Label cannot contain newlines")
    .optional(),
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = schema.parse(await request.json());
    const entry = await addWhitelist(body.ip, body.label);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add IP" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdminUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await removeWhitelist(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
}
