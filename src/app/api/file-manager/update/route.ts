import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { fileManagerWrite } from "@/lib/services/file-manager";

const schema = z.object({
  target: z.string().optional(),
  domainId: z.string().optional(),
  path: z.string(),
  content: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = schema.parse(await request.json());
    const target =
      body.target ??
      (body.domainId
        ? body.domainId.startsWith("d:") || body.domainId.startsWith("s:")
          ? body.domainId
          : `d:${body.domainId}`
        : undefined);
    if (!target) {
      return NextResponse.json({ success: false, message: "target required" }, { status: 400 });
    }
    await fileManagerWrite(target, user.id, body.path, body.content);
    return new NextResponse("Saved.", { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, message: "Invalid request" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Save failed" },
      { status: 500 }
    );
  }
}
