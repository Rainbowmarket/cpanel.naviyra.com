import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import {
  createFtpAccount,
  deleteFtpAccount,
  listFtpAccounts,
} from "@/lib/services/ftp";

function ftpConnectionInfo() {
  const host =
    process.env.SERVER_PUBLIC_IP?.trim() ||
    process.env.DEFAULT_SERVER_HOSTNAME?.trim() ||
    "your-server-ip";
  return {
    host,
    port: 21,
    passivePorts: "40000-40100",
    protocol: "ftp",
  };
}

export async function GET() {
  try {
    const user = await requireSessionUser("ftp");
    const accounts = await listFtpAccounts(user.id, user.role);
    return NextResponse.json({
      accounts,
      connection: ftpConnectionInfo(),
    });
  } catch (error) {
    return authFailureResponse(error);
  }
}

const createSchema = z.object({
  target: z.string().min(1),
  username: z
    .string()
    .regex(
      /^[a-z_][a-z0-9_-]{2,31}$/i,
      "Username must be 3–32 chars (letters, digits, _ or -)"
    ),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("ftp");
    const body = createSchema.parse(await request.json());
    const account = await createFtpAccount({
      ...body,
      userId: user.id,
      role: user.role,
    });
    return NextResponse.json(
      { account, connection: ftpConnectionInfo() },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create FTP account",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser("ftp");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteFtpAccount(id, user.id, user.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete FTP account",
      },
      { status: 500 }
    );
  }
}
