import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { userHasAdminAccess } from "@/lib/panel-permissions";
import { installMailSpamStack } from "@/lib/services/mail";

export async function POST() {
  try {
    const user = await requireSessionUser("mail");
    if (!userHasAdminAccess(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const result = await installMailSpamStack(user.id, user.role);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Spam stack install failed",
      },
      { status: 400 }
    );
  }
}
