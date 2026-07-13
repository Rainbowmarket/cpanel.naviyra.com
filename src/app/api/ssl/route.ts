import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  issueSslCertificate,
  issueSubdomainSslCertificate,
  listSslCertificates,
  renewSslCertificate,
} from "@/lib/services/ssl";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const certificates = await listSslCertificates(user.id);
    return NextResponse.json({ certificates });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

const issueSchema = z
  .object({
    domainId: z.string().optional(),
    subdomainId: z.string().optional(),
    includeWww: z.boolean().optional(),
    autoRenew: z.boolean().optional(),
  })
  .refine((data) => data.domainId || data.subdomainId, {
    message: "domainId or subdomainId required",
  })
  .refine((data) => !(data.domainId && data.subdomainId), {
    message: "Provide domainId or subdomainId, not both",
  });

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = issueSchema.parse(await request.json());

    const certificate = body.subdomainId
      ? await issueSubdomainSslCertificate({
          subdomainId: body.subdomainId,
          userId: user.id,
          autoRenew: body.autoRenew,
        })
      : await issueSslCertificate({
          domainId: body.domainId!,
          userId: user.id,
          includeWww: body.includeWww,
          autoRenew: body.autoRenew,
        });

    return NextResponse.json({ certificate }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to issue SSL" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const certificate = await renewSslCertificate(id, user.id);
    return NextResponse.json({ certificate });
  } catch {
    return NextResponse.json({ error: "Failed to renew SSL" }, { status: 500 });
  }
}
