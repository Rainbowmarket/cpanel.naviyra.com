import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { controllerAgentTarget } from "@/lib/agent/target";

const MAX_JOBS_PER_USER = 40;

export function validateCronSchedule(raw: string): string {
  const schedule = raw.trim().replace(/\s+/g, " ");
  const parts = schedule.split(" ");
  if (parts.length !== 5) {
    throw new Error("Schedule must be 5 cron fields (minute hour day month weekday)");
  }
  const field =
    /^(\*(\/[1-9]\d*)?|[0-9]+(-[0-9]+)?(\/[1-9]\d*)?)(,[0-9]+(-[0-9]+)?(\/[1-9]\d*)?)*$/;
  for (const part of parts) {
    if (!field.test(part)) {
      throw new Error(`Invalid cron field: ${part}`);
    }
  }
  return schedule;
}

export function validateCronCommand(raw: string): string {
  const command = raw.trim();
  if (command.length < 1 || command.length > 500) {
    throw new Error("Command must be 1–500 characters");
  }
  if (/[\r\n%]/.test(command)) {
    throw new Error("Command cannot contain newlines or %");
  }
  return command;
}

function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 80) {
    throw new Error("Name must be 1–80 characters");
  }
  return name;
}

async function syncAllJobsToAgent() {
  const jobs = await prisma.cronJob.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, schedule: true, command: true, enabled: true },
  });
  const result = await callAgent(
    {
      action: "sync_cron_jobs",
      jobs,
    },
    await controllerAgentTarget()
  );
  if (!result.success) {
    throw new Error(result.error ?? "Failed to write crontab on the server");
  }
  return result.data as { path?: string; count?: number; dryRun?: boolean };
}

export async function listCronJobs(userId: string, role?: string) {
  return prisma.cronJob.findMany({
    where: role === "ADMIN" ? undefined : { userId },
    orderBy: { createdAt: "desc" },
    include:
      role === "ADMIN" ? { user: { select: { email: true } } } : undefined,
  });
}

export async function createCronJob(input: {
  userId: string;
  name: string;
  schedule: string;
  command: string;
  enabled?: boolean;
}) {
  const count = await prisma.cronJob.count({ where: { userId: input.userId } });
  if (count >= MAX_JOBS_PER_USER) {
    throw new Error(`You can create at most ${MAX_JOBS_PER_USER} cron jobs`);
  }

  const job = await prisma.cronJob.create({
    data: {
      userId: input.userId,
      name: validateName(input.name),
      schedule: validateCronSchedule(input.schedule),
      command: validateCronCommand(input.command),
      enabled: input.enabled !== false,
    },
  });

  try {
    await syncAllJobsToAgent();
  } catch (error) {
    await prisma.cronJob.delete({ where: { id: job.id } }).catch(() => undefined);
    throw error;
  }

  return job;
}

export async function updateCronJob(input: {
  id: string;
  userId: string;
  role?: string;
  name?: string;
  schedule?: string;
  command?: string;
  enabled?: boolean;
}) {
  const existing = await prisma.cronJob.findFirst({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { userId: input.userId }),
    },
  });
  if (!existing) {
    throw new Error("Cron job not found");
  }

  const job = await prisma.cronJob.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: validateName(input.name) } : {}),
      ...(input.schedule !== undefined
        ? { schedule: validateCronSchedule(input.schedule) }
        : {}),
      ...(input.command !== undefined
        ? { command: validateCronCommand(input.command) }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });

  await syncAllJobsToAgent();
  return job;
}

export async function deleteCronJob(input: {
  id: string;
  userId: string;
  role?: string;
}) {
  const existing = await prisma.cronJob.findFirst({
    where: {
      id: input.id,
      ...(input.role === "ADMIN" ? {} : { userId: input.userId }),
    },
  });
  if (!existing) {
    throw new Error("Cron job not found");
  }
  await prisma.cronJob.delete({ where: { id: existing.id } });
  await syncAllJobsToAgent();
}
