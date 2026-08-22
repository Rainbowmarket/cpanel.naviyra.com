import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireAdminUser } from "@/lib/auth";
import {
  listDomainMigrations,
  migrateDomainToServer,
} from "@/lib/services/migrate";

export async function GET() {
  try {
    await requireAdminUser();
    const migrations = await listDomainMigrations();
    return NextResponse.json({ migrations });
  } catch (error) {
    return authFailureResponse(error);
  }
}

const createSchema = z.object({
  domainId: z.string().min(1),
  destServerId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const body = createSchema.parse(await request.json());
    const migration = await migrateDomainToServer(body);
    return NextResponse.json({ migration }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return (
      authFailureResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Migration failed" },
        { status: 400 }
      )
    );
  }
}
