import { prisma } from "@/lib/prisma";
import { sendAdminAlertEmail } from "@/lib/mail/system-mail";

export type AdminAlertKind =
  | "failure"
  | "storage"
  | "overload"
  | "slow"
  | "migration";

const KIND_LABEL: Record<AdminAlertKind, string> = {
  failure: "Failure",
  storage: "Out of storage",
  overload: "Overload",
  slow: "Running slow",
  migration: "Migration",
};

const COOLDOWN_MS = Number(
  process.env.ADMIN_ALERT_COOLDOWN_MS ?? 60 * 60 * 1000
); // default 1 hour

const DISK_CRITICAL = 90;
const CPU_OVERLOAD = 90;
const MEM_OVERLOAD = 90;
const LOAD_SLOW_PER_CORE = 1.5;

async function listAdminRecipients() {
  return prisma.user.findMany({
    where: {
      OR: [
        { role: "ADMIN" },
        {
          groupMemberships: {
            some: {
              group: { permissions: { some: { key: "admin" } } },
            },
          },
        },
      ],
    },
    select: { email: true, name: true },
  });
}

async function shouldSend(kind: AdminAlertKind, fingerprint: string) {
  const key = fingerprint.slice(0, 200);
  const existing = await prisma.adminAlertLog.findUnique({
    where: { kind_fingerprint: { kind, fingerprint: key } },
  });
  if (existing && Date.now() - existing.lastSentAt.getTime() < COOLDOWN_MS) {
    return { send: false as const, key };
  }
  return { send: true as const, key };
}

async function markSent(kind: AdminAlertKind, key: string) {
  await prisma.adminAlertLog.upsert({
    where: { kind_fingerprint: { kind, fingerprint: key } },
    create: { kind, fingerprint: key, lastSentAt: new Date() },
    update: { lastSentAt: new Date() },
  });
}

export async function notifyAdmins(input: {
  kind: AdminAlertKind;
  fingerprint: string;
  title: string;
  detail: string;
}): Promise<void> {
  try {
    if (process.env.ADMIN_ALERTS_ENABLED === "false") return;

    const gate = await shouldSend(input.kind, input.fingerprint);
    if (!gate.send) return;

    const recipients = await listAdminRecipients();
    if (recipients.length === 0) {
      console.warn("Admin alert skipped: no ADMIN users to email");
      return;
    }

    const kindLabel = KIND_LABEL[input.kind];
    const subject = `[Naviyra] ${kindLabel}: ${input.title}`.slice(0, 180);
    const text = [
      `Alert type: ${kindLabel}`,
      "",
      input.title,
      "",
      input.detail,
    ].join("\n");

    const results = await Promise.allSettled(
      recipients.map((user) =>
        sendAdminAlertEmail({
          to: user.email,
          name: user.name,
          kind: input.kind,
          subject,
          text,
        })
      )
    );
    let delivered = 0;
    for (const result of results) {
      if (result.status === "fulfilled") delivered += 1;
      else console.error("Admin alert email failed:", result.reason);
    }
    if (delivered > 0) await markSent(input.kind, gate.key);
  } catch (error) {
    console.error("Admin alert dispatch failed:", error);
  }
}

/** Fire-and-forget when an agent URL cannot be reached. */
export function notifyIfAgentUnreachable(error: string | undefined) {
  const prefix = "Could not reach agent at ";
  if (!error?.startsWith(prefix)) return;
  const agentUrl = error.slice(prefix.length).trim();
  if (!agentUrl) return;
  void notifyAdmins({
    kind: "failure",
    fingerprint: `agent:${agentUrl}`,
    title: `Could not reach agent at ${agentUrl}`,
    detail: `The panel could not contact the Server Agent at ${agentUrl}. Hosting changes for sites on that node will fail until the agent is reachable.`,
  });
}

export function notifyMigration(opts: {
  domain?: string;
  detail: string;
  failed?: boolean;
}) {
  const name = opts.domain?.trim() || "site";
  const suffix = opts.failed ? "fail" : "ok";
  void notifyAdmins({
    kind: "migration",
    fingerprint: `migration:${name}:${suffix}`,
    title: `Site migration / restore: ${name}`,
    detail: opts.detail,
  });
}

async function topMemoryProcesses(limit = 10): Promise<string> {
  if (process.platform === "win32") return "";
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    const { stdout } = await exec("ps", ["aux", "--sort=-%mem"], {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, limit + 1)
      .join("\n");
  } catch {
    return "";
  }
}

export async function evaluateAndNotifyHostAlerts(input: {
  hostname: string;
  cpuPercent: number | null;
  memPercent: number | null;
  load1: number | null;
  cores: number;
  diskPercent: number | null;
  diskLabel?: string;
  agentOnline?: boolean;
  agentUrl?: string;
}): Promise<void> {
  const host = input.hostname || "controller";
  const tasks: Promise<void>[] = [];

  if (input.agentOnline === false && input.agentUrl) {
    notifyIfAgentUnreachable(`Could not reach agent at ${input.agentUrl}`);
  }

  if (input.diskPercent != null && input.diskPercent >= DISK_CRITICAL) {
    tasks.push(
      notifyAdmins({
        kind: "storage",
        fingerprint: `storage:${host}`,
        title: `Disk space is critically low (${input.diskPercent}%)`,
        detail: [
          `Host: ${host}`,
          input.diskLabel ? `Volume: ${input.diskLabel}` : null,
          `Used: ${input.diskPercent}% (threshold ${DISK_CRITICAL}%). Free space on the controller node before mail, backups, and sites fail.`,
        ]
          .filter(Boolean)
          .join("\n"),
      })
    );
  }

  const cpuOver =
    input.cpuPercent != null && input.cpuPercent >= CPU_OVERLOAD;
  const memOver =
    input.memPercent != null && input.memPercent >= MEM_OVERLOAD;
  if (cpuOver || memOver) {
    const parts = [
      cpuOver ? `CPU ${input.cpuPercent}%` : null,
      memOver ? `RAM ${input.memPercent}%` : null,
    ].filter(Boolean);
    tasks.push(
      (async () => {
        const topMem = memOver ? await topMemoryProcesses(10) : "";
        await notifyAdmins({
          kind: "overload",
          fingerprint: `overload:${host}`,
          title: `Server overload on ${host} (${parts.join(", ")})`,
          detail: [
            `The controller host is over the ${CPU_OVERLOAD}% CPU / ${MEM_OVERLOAD}% RAM thresholds.`,
            `Current: ${parts.join(", ")}.`,
            `System load averages are separate; high RAM with low load usually means resident processes, not CPU thrashing.`,
            `On small (~2 GB) VPS hosts, panel + mail + DB often fill RAM after Node/agent/DB start.`,
            `Next email for this host waits for the admin alert cooldown (default 1 hour).`,
            topMem ? `\nTop memory processes:\n${topMem}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        });
      })()
    );
  }

  const cores = Math.max(1, input.cores || 1);
  if (
    input.load1 != null &&
    Number.isFinite(input.load1) &&
    input.load1 >= cores * LOAD_SLOW_PER_CORE
  ) {
    tasks.push(
      notifyAdmins({
        kind: "slow",
        fingerprint: `slow:${host}`,
        title: `${host} is running slowly (load ${input.load1.toFixed(2)})`,
        detail: `1-minute load average is ${input.load1.toFixed(2)} on ${cores} CPU core(s) (threshold ${LOAD_SLOW_PER_CORE}× cores). The panel host is overloaded or blocked on I/O.`,
      })
    );
  }

  await Promise.all(tasks);
}
