import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { userHasAdminAccess } from "@/lib/panel-permissions";
import {
  deleteMailQueueForAdmin,
  flushMailQueueForAdmin,
  listMailQueueForUser,
} from "@/lib/services/mail";

export async function GET() {
  try {
    const user = await requireSessionUser("mail");
    if (!userHasAdminAccess(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const data = await listMailQueueForUser(user.id, user.role);
    return NextResponse.json(data);
  } catch (error) {
    return authFailureResponse(error);
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("flush"), id: z.string().optional() }),
  z.object({ action: z.literal("delete"), id: z.string().min(1) }),
]);

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    if (!userHasAdminAccess(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = patchSchema.parse(await request.json());
    if (body.action === "flush") {
      await flushMailQueueForAdmin(user.id, user.role, body.id);
    } else {
      await deleteMailQueueForAdmin(user.id, user.role, body.id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Queue action failed",
      },
      { status: 400 }
    );
  }
}
