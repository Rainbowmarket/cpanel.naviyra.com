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
  includeDatabases?: boolean;
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

async function listDatabasesForDomain(domainId: string) {
  const rows = await prisma.postgresDatabase.findMany({
    where: { domainId, isActive: true },
    select: { dbName: true, roleName: true },
  });
  return rows.map((r) => ({ dbName: r.dbName, roleName: r.roleName }));
}

async function listAllDatabases() {
  const rows = await prisma.postgresDatabase.findMany({
    where: { isActive: true },
    select: {
      dbName: true,
      roleName: true,
      domain: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    dbName: r.dbName,
    roleName: r.roleName,
    domain: r.domain.name,
  }));
}

export async function getOrCreateBackupConfig() {
  const existing = await prisma.backupWorkerConfig.findUnique({
    where: { id: CONFIG_ID },
  });
  if (existing) return existing;

  return prisma.backupWorkerConfig.create({
    data: {
      id: CONFIG_ID,
      schedule: "DAILY_03",
      includePanelDb: false,
      includeSites: true,
      includeDns: true,
      includeMail: true,
      includeDatabases: true,
      backupRoot:
        process.platform === "win32"
          ? "data/backups"
          : "/var/backups/naviyra",
    },
  });
}

export async function listBackupRuns(limit = 40) {
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
      // Scheduled worker is per-domain only — never include panel DB
      includePanelDb: false,
      ...(input.includeSites !== undefined
        ? { includeSites: input.includeSites }
        : {}),
      ...(input.includeDns !== undefined
        ? { includeDns: input.includeDns }
        : {}),
      ...(input.includeMail !== undefined
        ? { includeMail: input.includeMail }
        : {}),
      ...(input.includeDatabases !== undefined
        ? { includeDatabases: input.includeDatabases }
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

  const databases = config.includeDatabases ? await listAllDatabases() : [];

  const agentResult = await callAgent(
    {
      action: "run_backup",
      backupRoot: config.backupRoot,
      retainCount: config.retainCount,
      includePanelDb: config.includePanelDb,
      includeSites: config.includeSites,
      includeDns: config.includeDns,
      includeMail: config.includeMail,
      includeDatabases: config.includeDatabases,
      databases,
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

export async function runDomainBackupNow(
  domainId: string,
  opts?: {
    includeSites?: boolean;
    includeDns?: boolean;
    includeMail?: boolean;
    includeDatabases?: boolean;
    source?: string;
  }
) {
  const config = await getOrCreateBackupConfig();
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) {
    throw new Error("Domain not found");
  }

  const includeSites = opts?.includeSites !== false;
  const includeDns = opts?.includeDns !== false;
  const includeMail = opts?.includeMail !== false;
  const includeDatabases = opts?.includeDatabases !== false;
  const source = opts?.source?.trim() || "domain";

  if (!includeSites && !includeDns && !includeMail && !includeDatabases) {
    throw new Error("Select at least one component to back up");
  }

  const databases = includeDatabases
    ? (await listDatabasesForDomain(domain.id)).map((db) => ({
        ...db,
        domain: domain.name,
      }))
    : [];

  const run = await prisma.backupRun.create({
    data: {
      status: "RUNNING",
      source,
    },
  });

  const agentResult = await callAgent(
    {
      action: "run_domain_backup",
      domain: domain.name,
      backupRoot: config.backupRoot,
      retainCount: config.retainCount,
      includeSites,
      includeDns,
      includeMail,
      includeDatabases,
      databases,
    },
    getAgentApiKey()
  );

  if (!agentResult.success) {
    const error = agentResult.error ?? "Domain backup failed";
    const failed = await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error,
        summary: JSON.stringify({ type: "domain", domain: domain.name }),
      },
    });
    return { run: failed };
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
        type: "domain",
        domain: domain.name,
        included: data.included ?? [],
        pruned: data.pruned ?? [],
      }),
    },
  });

  return { run: completed };
}

/** Scheduled / batch: one archive per domain (no full-panel backup). */
export async function runAllDomainBackupsNow(
  source: "manual" | "timer" = "manual"
) {
  const config = await getOrCreateBackupConfig();

  if (source === "timer" && !config.enabled) {
    return { skipped: true as const, reason: "Backup worker is disabled" };
  }

  const domains = await prisma.domain.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (domains.length === 0) {
    return { skipped: true as const, reason: "No domains to back up" };
  }

  if (
    !config.includeSites &&
    !config.includeDns &&
    !config.includeMail &&
    !config.includeDatabases
  ) {
    return {
      skipped: true as const,
      reason: "Enable at least one of: sites, DNS, mail, or databases",
    };
  }

  await prisma.backupWorkerConfig.update({
    where: { id: CONFIG_ID },
    data: {
      lastStatus: "RUNNING" satisfies JobStatus,
      lastError: null,
    },
  });

  const runs: Awaited<ReturnType<typeof runDomainBackupNow>>["run"][] = [];
  const errors: string[] = [];

  for (const domain of domains) {
    const { run } = await runDomainBackupNow(domain.id, {
      includeSites: config.includeSites,
      includeDns: config.includeDns,
      includeMail: config.includeMail,
      includeDatabases: config.includeDatabases,
      source,
    });
    runs.push(run);
    if (run.status === "FAILED") {
      errors.push(`${domain.name}: ${run.error ?? "failed"}`);
    }
  }

  const completed = runs.filter((r) => r.status === "COMPLETED");
  const lastOk = [...completed].reverse()[0];
  const allFailed = completed.length === 0;

  await prisma.backupWorkerConfig.update({
    where: { id: CONFIG_ID },
    data: {
      lastRunAt: new Date(),
      lastStatus: (allFailed ? "FAILED" : "COMPLETED") satisfies JobStatus,
      lastError: errors.length > 0 ? errors.slice(0, 8).join("; ") : null,
      lastArchive: lastOk?.archivePath ?? null,
    },
  });

  return {
    skipped: false as const,
    domains: domains.length,
    completed: completed.length,
    failed: runs.length - completed.length,
    runs,
  };
}

function isDomainArchive(
  archivePath: string | null | undefined,
  summary: string | null | undefined
): { domain?: string } | null {
  try {
    const parsed = JSON.parse(summary || "{}") as {
      type?: string;
      domain?: string;
    };
    if (parsed.type === "domain") {
      return { domain: parsed.domain };
    }
  } catch {
    /* ignore */
  }
  if (archivePath && /naviyra-domain-/i.test(archivePath)) {
    return {};
  }
  return null;
}

export async function restoreBackupRun(
  runId: string,
  opts?: {
    restorePanelDb?: boolean;
    restoreSites?: boolean;
    restoreDns?: boolean;
    restoreMail?: boolean;
    restoreDatabases?: boolean;
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
  const restoreDatabases = Boolean(opts?.restoreDatabases);

  const domainMeta = isDomainArchive(run.archivePath, run.summary);

  if (domainMeta) {
    if (!restoreSites && !restoreDns && !restoreMail && !restoreDatabases) {
      throw new Error("Select at least one component to restore");
    }

    const agentResult = await callAgent(
      {
        action: "restore_domain_backup",
        archivePath: run.archivePath,
        allowedRoot: config.backupRoot,
        domain: domainMeta.domain,
        restoreSites,
        restoreDns,
        restoreMail,
        restoreDatabases,
      },
      getAgentApiKey()
    );

    if (!agentResult.success) {
      throw new Error(agentResult.error ?? "Domain restore failed");
    }

    return agentResult.data as {
      restored: string[];
      safetyDbBackup?: string;
      panelRestartScheduled: boolean;
    };
  }

  if (
    !restorePanelDb &&
    !restoreSites &&
    !restoreDns &&
    !restoreMail &&
    !restoreDatabases
  ) {
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
      restoreDatabases,
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
