import { prisma } from "@/lib/prisma";
import {
  callAgent,
  downloadBackupFromAgent,
  uploadBackupToAgent,
} from "@/lib/agent/client";
import {
  agentTargetForServerId,
  controllerAgentTarget,
} from "@/lib/agent/target";
import { requireAgentApiKey } from "@/lib/secrets";
import { notifyMigration } from "@/lib/mail/admin-alerts";
import type { BackupSchedule, JobStatus } from "@/generated/prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

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
    await controllerAgentTarget()
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
    await controllerAgentTarget()
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
    await agentTargetForServerId(domain.serverId)
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

async function agentTargetForBackupRun(run: {
  archivePath: string | null;
  summary: string | null;
}) {
  const meta = isDomainArchive(run.archivePath, run.summary);
  if (meta?.domain) {
    const domain = await prisma.domain.findUnique({
      where: { name: meta.domain },
      select: { serverId: true },
    });
    if (domain) return agentTargetForServerId(domain.serverId);
  }
  return controllerAgentTarget();
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
      await agentTargetForBackupRun(run)
    );

    if (!agentResult.success) {
      throw new Error(agentResult.error ?? "Domain restore failed");
    }

    notifyMigration({
      domain: domainMeta.domain,
      detail: `A domain backup was restored for ${domainMeta.domain ?? "the site"} from ${run.archivePath}. Verify nginx, SSL, files, and databases on the assigned server, then remove leftover data on the old node if this was a move.`,
    });

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
    await controllerAgentTarget()
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
      await agentTargetForBackupRun(run)
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

function archiveUnderRoot(archivePath: string, backupRoot: string): boolean {
  const resolved = path.resolve(archivePath);
  const roots = [
    path.resolve(backupRoot),
    path.resolve("data/backups"),
    path.resolve("/var/backups/naviyra"),
  ];
  return roots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

export async function downloadBackupRun(runId: string): Promise<{
  fileName: string;
  content: Buffer;
}> {
  const config = await getOrCreateBackupConfig();
  const run = await prisma.backupRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "COMPLETED" || !run.archivePath) {
    throw new Error("Completed backup with an archive is required");
  }
  if (!archiveUnderRoot(run.archivePath, config.backupRoot)) {
    throw new Error("Archive is outside the backup root");
  }

  const remote = await downloadBackupFromAgent({
    target: await agentTargetForBackupRun(run),
    archivePath: run.archivePath,
    allowedRoot: config.backupRoot,
  });
  if (remote.success && remote.data?.content) {
    return {
      fileName: remote.data.fileName,
      content: remote.data.content,
    };
  }

  try {
    const resolved = path.resolve(run.archivePath);
    const content = await fs.readFile(resolved);
    return {
      fileName: path.basename(resolved),
      content,
    };
  } catch {
    throw new Error(remote.error ?? "Failed to download backup archive");
  }
}

export async function uploadBackupArchive(input: {
  fileName: string;
  content: Buffer;
}) {
  const { getMaxUploadMb } = await import("@/lib/services/panel-settings");
  const maxMb = await getMaxUploadMb();
  const maxBytes = maxMb * 1024 * 1024;
  if (input.content.length > maxBytes) {
    throw new Error(`Backup is larger than the ${maxMb} MB upload limit`);
  }

  const base = path.basename(input.fileName.replace(/\\/g, "/"));
  if (!/^[A-Za-z0-9._-]+\.(tar\.gz|tgz)$/.test(base)) {
    throw new Error("Upload a .tar.gz backup file");
  }

  const config = await getOrCreateBackupConfig();
  const domainMatch = /^naviyra-domain-(.+)-(\d{8}T\d{6}Z)\.(tar\.gz|tgz)$/i.exec(
    base
  );
  let uploadTarget = await controllerAgentTarget();
  if (domainMatch?.[1]) {
    const domain = await prisma.domain.findUnique({
      where: { name: domainMatch[1] },
      select: { serverId: true },
    });
    if (domain) {
      uploadTarget = await agentTargetForServerId(domain.serverId);
    }
  }
  const remote = await uploadBackupToAgent({
    target: uploadTarget,
    fileName: base,
    content: input.content,
    allowedRoot: config.backupRoot,
  });

  let archivePath = remote.data?.archivePath;
  let bytes = remote.data?.bytes ?? input.content.length;

  if (!remote.success || !archivePath || remote.data?.dryRun) {
    const localRoot = path.resolve(config.backupRoot || "data/backups");
    await fs.mkdir(localRoot, { recursive: true });
    archivePath = path.join(localRoot, base);
    await fs.writeFile(archivePath, input.content);
    bytes = (await fs.stat(archivePath)).size;
  }

  const now = new Date();
  const run = await prisma.backupRun.create({
    data: {
      status: "COMPLETED",
      source: "upload",
      startedAt: now,
      finishedAt: now,
      archivePath,
      sizeBytes: bytes,
      summary: JSON.stringify({
        type: domainMatch ? "domain" : "panel",
        domain: domainMatch?.[1],
        uploaded: true,
        included: [],
      }),
    },
  });

  return { run };
}
