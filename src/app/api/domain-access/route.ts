import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { userHasAdminAccess } from "@/lib/panel-permissions";
import {
  listDomainAccessFormOptions,
  listDomainAccessGrants,
  upsertDomainAccess,
} from "@/lib/services/domain-access";

async function requireAdmin() {
  const user = await requireSessionUser();
  if (!userHasAdminAccess(user)) {
    throw new Error("Forbidden");
  }
  return user;
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const domainId = url.searchParams.get("domainId") ?? undefined;
    const userId = url.searchParams.get("userId") ?? undefined;
    const form = url.searchParams.get("form") === "1";

    if (form) {
      const options = await listDomainAccessFormOptions();
      return NextResponse.json(options);
    }

    const grants = await listDomainAccessGrants({ domainId, userId });
    return NextResponse.json({ grants });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return authFailureResponse(error);
  }
}

const upsertSchema = z.object({
  domainId: z.string().min(1),
  userId: z.string().min(1),
  permissions: z.array(z.string()).min(1),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = upsertSchema.parse(await request.json());
    const grant = await upsertDomainAccess(body);
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
      { error: error instanceof Error ? error.message : "Failed to save grant" },
      { status: 400 }
    );
  }
}
