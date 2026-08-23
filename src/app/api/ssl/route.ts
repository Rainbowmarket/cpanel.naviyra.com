import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import {
  issueSslCertificate,
  issueSubdomainSslCertificate,
  listSslCertificates,
  renewSslCertificate,
} from "@/lib/services/ssl";
import { ensureInfraSslHostnames } from "@/lib/services/subdomains";
import { getPanelHostname } from "@/lib/base-domain";

export async function GET() {
  try {
    const user = await requireSessionUser("ssl");
    try {
      await ensureInfraSslHostnames(user.id);
    } catch (error) {
      console.error("ensureInfraSslHostnames failed:", error);
    }
    const certificates = await listSslCertificates(user.id, user.role);
    return NextResponse.json({
      certificates,
      panelHostname: getPanelHostname(),
    });
  } catch (error) {
    return authFailureResponse(error);
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
    const user = await requireSessionUser("ssl");
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
    const message =
      error instanceof Error ? error.message : "Failed to issue SSL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser("ssl");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const certificate = await renewSslCertificate(id, user.id);
    return NextResponse.json({ certificate });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to renew SSL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
