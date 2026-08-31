import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { userHasAdminAccess } from "@/lib/panel-permissions";
import {
  deleteDomainAccess,
  updateDomainAccess,
} from "@/lib/services/domain-access";

type RouteContext = { params: Promise<{ id: string }> };

async function requireAdmin() {
  const user = await requireSessionUser();
  if (!userHasAdminAccess(user)) {
    throw new Error("Forbidden");
  }
  return user;
}

const patchSchema = z.object({
  permissions: z.array(z.string()).min(1),
});

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const grant = await updateDomainAccess(id, body.permissions);
    return NextResponse.json({ grant });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update grant",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    await deleteDomainAccess(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return authFailureResponse(error);
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to revoke grant",
      },
      { status: 400 }
    );
  }
}
