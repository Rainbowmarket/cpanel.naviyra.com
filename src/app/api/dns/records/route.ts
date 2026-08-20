import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser  } from "@/lib/auth";
import {
  addDnsRecord,
  deleteDnsRecord,
  updateDnsRecord,
} from "@/lib/services/dns";
import { ensureMailHostSetup } from "@/lib/services/mail";

const addSchema = z.object({
  domainId: z.string(),
  name: z
    .string()
    .min(1)
    .max(253)
    .refine((v) => !/[\r\n\0\t$]/.test(v), "Invalid characters in name"),
  type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT"]),
  value: z
    .string()
    .min(1)
    .max(2048)
    .refine((v) => !/[\r\n\0]/.test(v), "Invalid characters in value"),
  ttl: z.number().int().positive().optional(),
  priority: z.number().int().min(0).max(65535).optional(),
});

const mailSchema = z.object({
  action: z.literal("mail"),
  domainId: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("dns");
    const body = await request.json();

    if (body.action === "mail") {
      const parsed = mailSchema.parse(body);
      const result = await ensureMailHostSetup(parsed.domainId, user.id);
      return NextResponse.json(result, { status: 201 });
    }

    const parsed = addSchema.parse(body);
    const zone = await addDnsRecord(parsed.domainId, user.id, parsed);
    return NextResponse.json({ zone }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to add DNS record" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser("dns");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing record id" }, { status: 400 });
    }
    const zone = await deleteDnsRecord(id, user.id);
    return NextResponse.json({ zone });
  } catch {
    return NextResponse.json({ error: "Failed to delete DNS record" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser("dns");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing record id" }, { status: 400 });
    }
    const parsed = addSchema.omit({ domainId: true }).parse(await request.json());
    const zone = await updateDnsRecord(id, user.id, parsed);
    return NextResponse.json({ zone });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update DNS record" }, { status: 500 });
  }
}
