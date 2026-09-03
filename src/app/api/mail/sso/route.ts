import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import { openMailboxAsPanelUser } from "@/lib/services/webmail";

/** Panel SSO: create mail session for a mailbox the user can manage, then open it. */
export async function POST(request: Request) {
  try {
    await requireSessionUser("mail");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const account = await openMailboxAsPanelUser(id);
    return NextResponse.json({
      accountId: account.id,
      email: account.email,
      url: `/mailbox/${account.id}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" ||
        error.message.includes("Mailbox is deactivated"))
    ) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return authFailureResponse(error);
  }
}
