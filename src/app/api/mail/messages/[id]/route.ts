import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  deleteWebmailMessage,
  getWebmailMessage,
  moveWebmailMessage,
  parseMailFolder,
} from "@/lib/services/webmail";
import { MAIL_FOLDERS } from "@/lib/mail/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const folderParam = searchParams.get("folder");

    if (!accountId || !folderParam) {
      return NextResponse.json({ error: "accountId and folder required" }, { status: 400 });
    }

    const folder = parseMailFolder(folderParam);
    if (!folder) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    const data = await getWebmailMessage(accountId, user.id, folder, id);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Message not found" },
      { status: 404 }
    );
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    accountId: z.string(),
    folder: z.enum(MAIL_FOLDERS),
    targetFolder: z.enum(MAIL_FOLDERS),
  }),
]);

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());

    const result = await moveWebmailMessage(
      body.accountId,
      user.id,
      body.folder,
      id,
      body.targetFolder
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update message" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireSessionUser();
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const folderParam = searchParams.get("folder");
    const permanent = searchParams.get("permanent") === "true";

    if (!accountId || !folderParam) {
      return NextResponse.json({ error: "accountId and folder required" }, { status: 400 });
    }

    const folder = parseMailFolder(folderParam);
    if (!folder) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    const result = await deleteWebmailMessage(
      accountId,
      user.id,
      folder,
      id,
      permanent
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete message" },
      { status: 500 }
    );
  }
}
