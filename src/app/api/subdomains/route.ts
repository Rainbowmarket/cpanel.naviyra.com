import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  createSubdomain,
  deleteSubdomain,
  listAllSubdomains,
  listSubdomains,
  resolveCustomSubdomainFqdn,
  retrySubdomain,
  updateSubdomainPath,
} from "@/lib/services/subdomains";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const domainId = new URL(request.url).searchParams.get("domainId");
    const subdomains = domainId
      ? await listSubdomains(domainId, user.id, { role: user.role })
      : await listAllSubdomains(user.id, { role: user.role });
    return NextResponse.json({ subdomains });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const createSchema = z
  .object({
    domainId: z.string().optional(),
    name: z.string().min(1).optional(),
    fqdn: z.string().min(1).optional(),
    documentRoot: z.string().optional(),
    appType: z.enum(["STATIC", "PHP", "PYTHON", "GO", "NODE"]).optional(),
  })
  .refine((b) => Boolean(b.fqdn) || (Boolean(b.domainId) && Boolean(b.name)), {
    message: "Provide fqdn or domainId+name",
  });

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = createSchema.parse(await request.json());

    let domainId = body.domainId;
    let name = body.name;

    if (body.fqdn) {
      const resolved = await resolveCustomSubdomainFqdn(
        body.fqdn,
        user.id,
        user.role
      );
      domainId = resolved.domainId;
      name = resolved.name;
    }

    const subdomain = await createSubdomain({
      domainId: domainId!,
      name: name!,
      documentRoot: body.documentRoot,
      appType: body.appType,
      userId: user.id,
      allowPanelDomain: user.role === "ADMIN",
    });
    return NextResponse.json({ subdomain }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create subdomain",
      },
      { status: 500 }
    );
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
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update subdomain",
      },
      { status: 400 }
    );
  }
}
