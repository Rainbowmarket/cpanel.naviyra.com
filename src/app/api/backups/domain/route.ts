import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { runDomainBackupNow } from "@/lib/services/backups";

const schema = z
  .object({
    domainId: z.string().min(1),
    includeSites: z.boolean().optional(),
    includeDns: z.boolean().optional(),
    includeMail: z.boolean().optional(),
    includeDatabases: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.includeSites !== false ||
      v.includeDns !== false ||
      v.includeMail !== false ||
      v.includeDatabases !== false,
    { message: "Select at least one component to back up" }
  );

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = schema.parse(await request.json());
    const result = await runDomainBackupNow(body.domainId, {
      includeSites: body.includeSites,
      includeDns: body.includeDns,
      includeMail: body.includeMail,
      includeDatabases: body.includeDatabases,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Domain backup failed",
      },
      { status: 500 }
    );
  }
}
