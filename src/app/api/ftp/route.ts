import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  createFtpAccount,
  deleteFtpAccount,
  listFtpAccounts,
} from "@/lib/services/ftp";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const domainId = new URL(request.url).searchParams.get("domainId");
    if (!domainId) {
      return NextResponse.json({ error: "domainId required" }, { status: 400 });
    }
    const accounts = await listFtpAccounts(domainId, user.id);
    return NextResponse.json({ accounts });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const createSchema = z.object({
  domainId: z.string(),
  username: z.string().min(3),
  password: z.string().min(8),
  homeDir: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = createSchema.parse(await request.json());
    const account = await createFtpAccount({ ...body, userId: user.id });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create FTP account" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteFtpAccount(id, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete FTP account" }, { status: 500 });
  }
}
