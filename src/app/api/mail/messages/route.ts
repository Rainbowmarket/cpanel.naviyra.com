import { NextResponse } from "next/server";
import {
  composeWebmailMessage,
  getWebmailMessages,
  getWebmailOverview,
  parseMailFolder,
} from "@/lib/services/webmail";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId required" }, { status: 400 });
    }

    const folderParam = searchParams.get("folder");
    if (!folderParam) {
      const overview = await getWebmailOverview(accountId);
      return NextResponse.json(overview);
    }

    const folder = parseMailFolder(folderParam);
    if (!folder) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    const data = await getWebmailMessages(accountId, folder);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "You do not have access to this feature" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load mailbox" },
      { status: 500 }
    );
  }
}

const composeSchema = z.object({
  accountId: z.string(),
  to: z.array(z.string().email()).default([]),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().default(""),
  body: z.string().default(""),
  draft: z.boolean().optional(),
  draftId: z.string().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().max(200).optional(),
        contentBase64: z.string().min(1),
      })
    )
    .max(10)
    .optional(),
});

export async function POST(request: Request) {
  try {
    const body = composeSchema.parse(await request.json());
    const recipientCount =
      body.to.length + (body.cc?.length ?? 0) + (body.bcc?.length ?? 0);
    if (!body.draft && recipientCount === 0) {
      return NextResponse.json(
        { error: "Add at least one recipient" },
        { status: 400 }
      );
    }
    const result = await composeWebmailMessage(body.accountId, {
      to: body.to,
      cc: body.cc,
      bcc: body.bcc,
      subject: body.subject,
      body: body.body,
      draft: body.draft,
      draftId: body.draftId,
      attachments: body.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType || "application/octet-stream",
        contentBase64: a.contentBase64,
      })),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "You do not have access to this feature" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid recipient email address" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message" },
      { status: 500 }
    );
  }
}
