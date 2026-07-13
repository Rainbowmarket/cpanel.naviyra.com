import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { createUser, deleteUser, listUsers } from "@/lib/services/users";

export async function GET() {
  try {
    await requireAdminUser();
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "RESELLER", "USER"]).optional(),
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = createSchema.parse(await request.json());
    const user = await createUser(body);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error) {
      if (error.message === "Forbidden") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      if (error.message === "Email already in use") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdminUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteUser(id, admin.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Forbidden") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      if (
        error.message === "Cannot delete your own account" ||
        error.message === "Cannot delete the last admin"
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
