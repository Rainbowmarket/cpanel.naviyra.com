import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import {
  runServiceTest,
  SERVICE_TEST_CATALOG,
} from "@/lib/services/service-tests";

async function requireAdmin() {
  const user = await requireSessionUser();
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tests: SERVICE_TEST_CATALOG });
}

const bodySchema = z.object({
  id: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await request.json();
    const { id } = bodySchema.parse(json);
    const result = await runServiceTest(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid test id" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Test failed" },
      { status: 500 }
    );
  }
}
