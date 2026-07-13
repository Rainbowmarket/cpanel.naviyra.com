import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  composeWebmailMessage,
  getWebmailMessages,
  getWebmailOverview,
  parseMailFolder,
} from "@/lib/services/webmail";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId required" }, { status: 400 });
    }

    const folderParam = searchParams.get("folder");
    if (!folderParam) {
      const overview = await getWebmailOverview(accountId, user.id);
      return NextResponse.json(overview);
    }

    const folder = parseMailFolder(folderParam);
    if (!folder) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }

    const data = await getWebmailMessages(accountId, user.id, folder);
    return NextResponse.json(data);
  } catch (error) {
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
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).optional(),
  subject: z.string().default(""),
  body: z.string().default(""),
  draft: z.boolean().optional(),
  draftId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = composeSchema.parse(await request.json());
    const result = await composeWebmailMessage(body.accountId, user.id, {
      to: body.to,
      cc: body.cc,
      subject: body.subject,
      body: body.body,
      draft: body.draft,
      draftId: body.draftId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message" },
      { status: 500 }
    );
  }
}
