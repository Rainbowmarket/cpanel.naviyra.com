import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { fileManagerCreate } from "@/lib/services/file-manager";
import { targetFromSearchParams } from "@/lib/file-manager-target";

async function handleCreate(request: Request) {
  const user = await requireSessionUser();
  const contentType = request.headers.get("content-type") ?? "";
  let target = "";
  let action = "";
  let dirPath = "";
  let name = "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    target = String(body.target ?? body.domainId ?? "");
    if (target && !target.startsWith("d:") && !target.startsWith("s:")) {
      target = `d:${target}`;
    }
    action = String(body.action ?? "");
    dirPath = String(body.p ?? body.path ?? "");
    name = String(body.name ?? "");
  } else {
    const form = await request.formData().catch(() => null);
    if (form) {
      target = String(form.get("target") ?? form.get("domainId") ?? "");
      if (target && !target.startsWith("d:") && !target.startsWith("s:")) {
        target = `d:${target}`;
      }
      action = String(form.get("action") ?? "");
      dirPath = String(form.get("p") ?? form.get("path") ?? "");
      name = String(form.get("name") ?? "");
    } else {
      const { searchParams } = new URL(request.url);
      target = targetFromSearchParams(searchParams);
      action = searchParams.get("action") ?? "";
      dirPath = searchParams.get("p") ?? "";
      name = searchParams.get("name") ?? "";
    }
  }

  if (!target) {
    return new NextResponse("target required", { status: 400 });
  }
  if (action !== "createFolder" && action !== "createFile") {
    return new NextResponse("Invalid request", { status: 400 });
  }
  if (!name.trim()) {
    return new NextResponse("name required", { status: 400 });
  }

  const message = await fileManagerCreate(
    target,
    { id: user.id, role: user.role },
    dirPath,
    name,
    action
  );
  return new NextResponse(message, { status: 200 });
}

/** State-changing — GET rejected (CSRF). */
export async function GET() {
  return new NextResponse("Method Not Allowed — use POST", { status: 405 });
}

export async function POST(request: Request) {
  try {
    return await handleCreate(request);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return new NextResponse("Not authenticated", { status: 401 });
    }
    return new NextResponse(error instanceof Error ? error.message : "Create failed", {
      status: 500,
    });
  }
}
