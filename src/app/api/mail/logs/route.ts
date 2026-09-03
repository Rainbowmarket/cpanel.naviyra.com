import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { userHasAdminAccess } from "@/lib/panel-permissions";
import { tailMailLogForAdmin } from "@/lib/services/mail";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser("mail");
    if (!userHasAdminAccess(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const lines = Number(
      new URL(request.url).searchParams.get("lines") ?? "100"
    );
    const data = await tailMailLogForAdmin(user.id, user.role, lines);
    return NextResponse.json(data);
  } catch (error) {
    return authFailureResponse(error);
  }
}
