import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureResponse, requireSessionUser } from "@/lib/auth";
import {
  createCronJob,
  deleteCronJob,
  listCronJobs,
  updateCronJob,
} from "@/lib/services/cron";

export async function GET() {
  try {
    const user = await requireSessionUser("cron");
    const jobs = await listCronJobs(user.id, user.role);
    return NextResponse.json({ jobs });
  } catch (error) {
    return authFailureResponse(error);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  schedule: z.string().min(5).max(80),
  command: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  schedule: z.string().min(5).max(80).optional(),
  command: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser("cron");
    const body = createSchema.parse(await request.json());
    const job = await createCronJob({
      userId: user.id,
      name: body.name,
      schedule: body.schedule,
      command: body.command,
      enabled: body.enabled,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create cron job",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSessionUser("cron");
    const body = updateSchema.parse(await request.json());
    const job = await updateCronJob({
      id: body.id,
      userId: user.id,
      role: user.role,
      name: body.name,
      schedule: body.schedule,
      command: body.command,
      enabled: body.enabled,
    });
    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update cron job",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser("cron");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    await deleteCronJob({ id, userId: user.id, role: user.role });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete cron job",
      },
      { status: 500 }
    );
  }
}
