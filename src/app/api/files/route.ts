import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { listFiles, readFile, writeFile } from "@/lib/services/files";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const domainId = searchParams.get("domainId");
    const path = searchParams.get("path");
    const read = searchParams.get("read") === "true";

    if (!domainId) {
      return NextResponse.json({ error: "domainId required" }, { status: 400 });
    }

    if (read && path) {
      const content = await readFile(path, domainId, user.id);
      return NextResponse.json({ content });
    }

    const entries = await listFiles(path ?? "", domainId, user.id);
    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "File operation failed" },
      { status: 500 }
    );
  }
}

const writeSchema = z.object({
  domainId: z.string(),
  path: z.string(),
  content: z.string(),
});

export async function PUT(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = writeSchema.parse(await request.json());
    await writeFile(body.path, body.content, body.domainId, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to write file" }, { status: 500 });
  }
}
