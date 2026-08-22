import fs from "node:fs/promises";
import path from "node:path";

const CRON_FILE = "/etc/cron.d/naviyra-jobs";
const CRON_USER = (process.env.PANEL_CRON_USER || "root").trim() || "root";

export type CronJobLine = {
  id: string;
  schedule: string;
  command: string;
  enabled?: boolean;
};

function assertSafeCronUser(user: string) {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user)) {
    throw new Error("Invalid cron user");
  }
}

export function assertSafeCronSchedule(raw: string): string {
  const schedule = raw.trim().replace(/\s+/g, " ");
  const parts = schedule.split(" ");
  if (parts.length !== 5) {
    throw new Error("Schedule must be 5 cron fields (minute hour day month weekday)");
  }
  const field = /^(\*(\/[1-9]\d*)?|[0-9]+(-[0-9]+)?(\/[1-9]\d*)?)(,[0-9]+(-[0-9]+)?(\/[1-9]\d*)?)*$/;
  for (const part of parts) {
    if (!field.test(part)) {
      throw new Error(`Invalid cron field: ${part}`);
    }
  }
  return schedule;
}

export function assertSafeCronCommand(raw: string): string {
  const command = raw.trim();
  if (command.length < 1 || command.length > 500) {
    throw new Error("Command must be 1–500 characters");
  }
  if (/[\r\n%]/.test(command)) {
    throw new Error("Command cannot contain newlines or %");
  }
  return command;
}

function renderCronFile(jobs: CronJobLine[]): string {
  assertSafeCronUser(CRON_USER);
  const lines = [
    "# Managed by Naviyra Panel — do not edit by hand",
    "SHELL=/bin/bash",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "MAILTO=\"\"",
    "",
  ];
  for (const job of jobs) {
    if (job.enabled === false) continue;
    const schedule = assertSafeCronSchedule(job.schedule);
    const command = assertSafeCronCommand(job.command);
    const id = job.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    lines.push(`# naviyra:${id}`);
    lines.push(`${schedule} ${CRON_USER} ${command}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function syncCronJobsOnServer(input: {
  jobs: CronJobLine[];
  dryRun: boolean;
}): Promise<{ path: string; count: number; dryRun: boolean }> {
  const jobs = Array.isArray(input.jobs) ? input.jobs.slice(0, 200) : [];
  const body = renderCronFile(jobs);
  const count = jobs.filter((j) => j.enabled !== false).length;

  if (process.platform === "win32" || input.dryRun) {
    return { path: CRON_FILE, count, dryRun: true };
  }

  await fs.mkdir(path.dirname(CRON_FILE), { recursive: true });
  await fs.writeFile(CRON_FILE, body, { encoding: "utf8", mode: 0o644 });
  return { path: CRON_FILE, count, dryRun: false };
}
