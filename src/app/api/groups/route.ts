import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import {
  createGroup,
  deleteGroup,
  listAssignableUsers,
  listGroups,
  updateGroup,
} from "@/lib/services/groups";
import { PANEL_PERMISSION_KEYS } from "@/lib/panel-permissions";

export async function GET() {
  try {
    await requireAdminUser();
    const [groups, users] = await Promise.all([listGroups(), listAssignableUsers()]);
    return NextResponse.json({
      groups,
      users,
      catalog: PANEL_PERMISSION_KEYS,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const groupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(240).optional(),
  permissionKeys: z.array(z.string()).default([]),
  userIds: z.array(z.string().min(1)).default([]),
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = groupSchema.parse(await request.json());
    const group = await createGroup(body);
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error) {
      if (error.message === "Forbidden") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      if (
        error.message === "Group name already in use" ||
        error.message === "Admin accounts cannot be added to permission groups" ||
        error.message === "One or more users were not found" ||
        error.message === "Group name is required"
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
  }
}

const updateSchema = groupSchema.extend({
  id: z.string().min(1),
});

export async function PATCH(request: Request) {
  try {
    await requireAdminUser();
    const body = updateSchema.parse(await request.json());
    const group = await updateGroup(body);
    return NextResponse.json({ group });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error) {
      if (error.message === "Forbidden") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      if (
        error.message === "Group name already in use" ||
        error.message === "Admin accounts cannot be added to permission groups" ||
        error.message === "One or more users were not found" ||
        error.message === "Group name is required"
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdminUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteGroup(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }
}
