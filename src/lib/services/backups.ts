import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getAgentApiKey } from "@/lib/paths";
import { requireAgentApiKey } from "@/lib/secrets";
import type { BackupSchedule, JobStatus } from "@/generated/prisma/client";

const CONFIG_ID = "default";

export type BackupConfigUpdate = {
  enabled?: boolean;
  schedule?: BackupSchedule;
  retainCount?: number;
  includePanelDb?: boolean;
  includeSites?: boolean;
  includeDns?: boolean;
  includeMail?: boolean;
  backupRoot?: string;
};

function workerToken(): string {
  const explicit = process.env.BACKUP_WORKER_TOKEN?.trim();
  if (explicit && explicit.length >= 16 && explicit !== "change-me") {
    return explicit;
  }
  return requireAgentApiKey();
}

function panelPort(): number {
  return Number(process.env.PANEL_PORT || 3100);
}

export async function getOrCreateBackupConfig() {
  const existing = await prisma.backupWorkerConfig.findUnique({
    where: { id: CONFIG_ID },
  });
  if (existing) return existing;

  return prisma.backupWorkerConfig.create({
    data: {
      id: CONFIG_ID,
      backupRoot:
        process.platform === "win32"
          ? "data/backups"
          : "/var/backups/naviyra",
    },
  });
}

export async function listBackupRuns(limit = 20) {
  return prisma.backupRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

export async function updateBackupConfig(input: BackupConfigUpdate) {
  await getOrCreateBackupConfig();

  const config = await prisma.backupWorkerConfig.update({
    where: { id: CONFIG_ID },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.schedule ? { schedule: input.schedule } : {}),
      ...(input.retainCount !== undefined
        ? { retainCount: Math.max(1, Math.min(60, input.retainCount)) }
        : {}),
      ...(input.includePanelDb !== undefined
        ? { includePanelDb: input.includePanelDb }
        : {}),
      ...(input.includeSites !== undefined
        ? { includeSites: input.includeSites }
        : {}),
      ...(input.includeDns !== undefined
        ? { includeDns: input.includeDns }
        : {}),
      ...(input.includeMail !== undefined
        ? { includeMail: input.includeMail }
        : {}),
      ...(input.backupRoot?.trim()
        ? { backupRoot: input.backupRoot.trim() }
        : {}),
    },
  });

  const timer = await callAgent(
    {
      action: "configure_backup_timer",
      enabled: config.enabled,
      schedule: config.schedule,
      panelPort: panelPort(),
      workerToken: workerToken(),
    },
    getAgentApiKey()
  );

  if (timer.success) {
    return prisma.backupWorkerConfig.update({
      where: { id: CONFIG_ID },
      data: {
        timerInstalled: Boolean(
          (timer.data as { installed?: boolean } | undefined)?.installed
        ),
      },
    });
  }

  return config;
}

export async function runBackupNow(source: "manual" | "timer" = "manual") {
  const config = await getOrCreateBackupConfig();

  if (source === "timer" && !config.enabled) {
    return { skipped: true as const, reason: "Backup worker is disabled" };
  }

  const run = await prisma.backupRun.create({
    data: {
      status: "RUNNING",
      source,
    },
  });

  await prisma.backupWorkerConfig.update({
    where: { id: CONFIG_ID },
    data: {
      lastStatus: "RUNNING" satisfies JobStatus,
      lastError: null,
    },
  });

  const agentResult = await callAgent(
    {
      action: "run_backup",
      backupRoot: config.backupRoot,
      retainCount: config.retainCount,
      includePanelDb: config.includePanelDb,
      includeSites: config.includeSites,
      includeDns: config.includeDns,
      includeMail: config.includeMail,
    },
    getAgentApiKey()
  );

  if (!agentResult.success) {
    const error = agentResult.error ?? "Backup failed";
    const failed = await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error,
      },
    });
    await prisma.backupWorkerConfig.update({
      where: { id: CONFIG_ID },
      data: {
        lastRunAt: new Date(),
        lastStatus: "FAILED",
        lastError: error,
      },
    });
    return { skipped: false as const, run: failed };
  }

  const data = (agentResult.data ?? {}) as {
    archivePath?: string;
    sizeBytes?: number;
    included?: string[];
    pruned?: string[];
  };

  const completed = await prisma.backupRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      finishedAt: new Date(),
      archivePath: data.archivePath ?? null,
      sizeBytes: data.sizeBytes ?? null,
      summary: JSON.stringify({
        included: data.included ?? [],
        pruned: data.pruned ?? [],
      }),
    },
  });

  await prisma.backupWorkerConfig.update({
    where: { id: CONFIG_ID },
    data: {
      lastRunAt: new Date(),
      lastStatus: "COMPLETED",
      lastError: null,
      lastArchive: data.archivePath ?? null,
    },
  });

  return { skipped: false as const, run: completed };
}

export async function restoreBackupRun(
  runId: string,
  opts?: {
    restorePanelDb?: boolean;
    restoreSites?: boolean;
    restoreDns?: boolean;
    restoreMail?: boolean;
  }
) {
  const config = await getOrCreateBackupConfig();
  const run = await prisma.backupRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "COMPLETED" || !run.archivePath) {
    throw new Error("Completed backup run with an archive is required");
  }

  const restorePanelDb = Boolean(opts?.restorePanelDb);
  const restoreSites = Boolean(opts?.restoreSites);
  const restoreDns = Boolean(opts?.restoreDns);
  const restoreMail = Boolean(opts?.restoreMail);

  if (!restorePanelDb && !restoreSites && !restoreDns && !restoreMail) {
    throw new Error("Select at least one component to restore");
  }

  const agentResult = await callAgent(
    {
      action: "restore_backup",
      archivePath: run.archivePath,
      allowedRoot: config.backupRoot,
      restorePanelDb,
      restoreSites,
      restoreDns,
      restoreMail,
    },
    getAgentApiKey()
  );

  if (!agentResult.success) {
    throw new Error(agentResult.error ?? "Restore failed");
  }

  return agentResult.data as {
    restored: string[];
    safetyDbBackup?: string;
    panelRestartScheduled: boolean;
  };
}

export async function deleteBackupRun(runId: string) {
  const config = await getOrCreateBackupConfig();
  const run = await prisma.backupRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new Error("Backup run not found");
  }

  if (run.archivePath) {
    const agentResult = await callAgent(
      {
        action: "delete_backup",
        archivePath: run.archivePath,
        allowedRoot: config.backupRoot,
      },
      getAgentApiKey()
    );
    if (!agentResult.success) {
      throw new Error(agentResult.error ?? "Failed to delete backup archive");
    }
  }

  await prisma.backupRun.delete({ where: { id: runId } });

  if (run.archivePath && config.lastArchive === run.archivePath) {
    await prisma.backupWorkerConfig.update({
      where: { id: CONFIG_ID },
      data: { lastArchive: null },
    });
  }

  return { ok: true as const, deletedRunId: runId, archivePath: run.archivePath };
}
