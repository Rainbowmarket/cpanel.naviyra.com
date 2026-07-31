import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteWebmailMessage,
  getWebmailMessage,
  markWebmailMessageRead,
  moveWebmailMessage,
  parseMailFolder,
  restoreWebmailMessage,
} from "@/lib/services/webmail";
import { MAIL_FOLDERS } from "@/lib/mail/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
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

    const data = await getWebmailMessage(accountId, folder, id);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
  z.object({
    action: z.literal("mark_read"),
    accountId: z.string(),
    folder: z.enum(MAIL_FOLDERS),
    read: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("restore"),
    accountId: z.string(),
    folder: z.enum(MAIL_FOLDERS),
  }),
]);

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());

    if (body.action === "mark_read") {
      const result = await markWebmailMessageRead(
        body.accountId,
        body.folder,
        id,
        body.read
      );
      return NextResponse.json(result);
    }

    if (body.action === "restore") {
      const result = await restoreWebmailMessage(body.accountId, body.folder, id);
      return NextResponse.json(result);
    }

    const result = await moveWebmailMessage(
      body.accountId,
      body.folder,
      id,
      body.targetFolder
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
      folder,
      id,
      permanent
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete message" },
      { status: 500 }
    );
  }
}
