import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  createSubdomain,
  deleteSubdomain,
  listSubdomains,
  retrySubdomain,
  updateSubdomainPath,
} from "@/lib/services/subdomains";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const domainId = new URL(request.url).searchParams.get("domainId");
    if (!domainId) {
      return NextResponse.json({ error: "domainId required" }, { status: 400 });
    }
    const subdomains = await listSubdomains(domainId, user.id);
    return NextResponse.json({ subdomains });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const createSchema = z.object({
  domainId: z.string(),
  name: z.string().min(1),
  documentRoot: z.string().optional(),
  appType: z.enum(["STATIC", "PHP", "PYTHON", "GO"]).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = createSchema.parse(await request.json());
    const subdomain = await createSubdomain({ ...body, userId: user.id });
    return NextResponse.json({ subdomain }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create subdomain" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const deleteFiles = searchParams.get("deleteFiles") === "true";
    await deleteSubdomain(id, user.id, deleteFiles);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete subdomain" }, { status: 500 });
  }
}

const patchSchema = z.object({
  documentRoot: z.string().min(1).optional(),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const body = patchSchema.parse(await request.json().catch(() => ({})));

    const subdomain = body.documentRoot
      ? await updateSubdomainPath(id, user.id, body.documentRoot)
      : await retrySubdomain(id, user.id);

    return NextResponse.json({ subdomain });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update subdomain" }, { status: 500 });
  }
}
