import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { fileManagerAction } from "@/lib/services/file-manager";

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("files");
    const form = await request.formData();
    const target = String(form.get("target") ?? form.get("domainId") ?? "");
    const normalizedTarget =
      target.startsWith("d:") || target.startsWith("s:") ? target : target ? `d:${target}` : "";
    const action = String(form.get("action") ?? "") as "rename" | "move" | "copy";
    const source = String(form.get("source") ?? "");
    const name = form.get("name") ? String(form.get("name")) : undefined;
    const dest = form.get("dest") ? String(form.get("dest")) : undefined;

    if (!normalizedTarget || !action || !source) {
      return NextResponse.json({ success: false, message: "Invalid request" }, { status: 400 });
    }

    const message = await fileManagerAction(normalizedTarget, { id: user.id, role: user.role }, action, {
      source,
      name,
      dest,
    });
    return NextResponse.json({ success: true, message });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ success: false, message: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Action failed" },
      { status: 500 }
    );
  }
}
