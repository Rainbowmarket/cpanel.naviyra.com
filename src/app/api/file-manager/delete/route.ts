import { NextResponse } from "next/server";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import { fileManagerDelete } from "@/lib/services/file-manager";
import { targetFromSearchParams } from "@/lib/file-manager-target";

async function handleDelete(request: Request) {
  const user = await requireSessionUser("files");
  const contentType = request.headers.get("content-type") ?? "";
  let target = "";
  let action = "";
  let targetPath = "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    target = String(body.target ?? body.domainId ?? "");
    if (target && !target.startsWith("d:") && !target.startsWith("s:")) {
      target = `d:${target}`;
    }
    action = String(body.action ?? "");
    targetPath = String(body.p ?? body.path ?? "");
  } else {
    const form = await request.formData().catch(() => null);
    if (form) {
      target = String(form.get("target") ?? form.get("domainId") ?? "");
      if (target && !target.startsWith("d:") && !target.startsWith("s:")) {
        target = `d:${target}`;
      }
      action = String(form.get("action") ?? "");
      targetPath = String(form.get("p") ?? form.get("path") ?? "");
    } else {
      const { searchParams } = new URL(request.url);
      target = targetFromSearchParams(searchParams);
      action = searchParams.get("action") ?? "";
      targetPath = searchParams.get("p") ?? "";
    }
  }

  if (!target) {
    return new NextResponse("target required", { status: 400 });
  }
  if (!targetPath) {
    return new NextResponse("Invalid request", { status: 400 });
  }

  const message = await fileManagerDelete(
    target,
    { id: user.id, role: user.role },
    targetPath,
    action === "deleteFile"
  );
  return new NextResponse(message, { status: 200 });
}

/** State-changing — GET rejected (CSRF). */
export async function GET() {
  return new NextResponse("Method Not Allowed — use POST", { status: 405 });
}

export async function POST(request: Request) {
  try {
    return await handleDelete(request);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new NextResponse("Not authenticated", { status: 401 });
    }
    return new NextResponse(error instanceof Error ? error.message : "Delete failed", {
      status: 500,
    });
  }
}
