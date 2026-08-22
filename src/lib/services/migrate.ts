import { prisma } from "@/lib/prisma";
import {
  callAgent,
  downloadBackupFromAgent,
  uploadBackupToAgent,
} from "@/lib/agent/client";
import {
  agentTargetForServerId,
  assertAgentTarget,
} from "@/lib/agent/target";
import { getOrCreateBackupConfig } from "@/lib/services/backups";
import { notifyMigration } from "@/lib/mail/admin-alerts";
import { phpEnabledForAppType } from "@/lib/apps/runtime-helpers";
import { isPanelHostname } from "@/lib/panel-host";

const STEPS = [
  "Export files",
  "Export databases",
  "Transfer data",
  "Import on target server",
  "Rebuild web server configuration",
  "Restore SSL",
  "Verify health",
  "Update serverId",
  "Remove old resources",
] as const;

async function setStep(
  id: string,
  step: number,
  extra?: { lastError?: string | null; archivePath?: string | null }
) {
  return prisma.domainMigration.update({
    where: { id },
    data: {
      step,
      stepLabel: STEPS[step - 1] ?? null,
      status: "RUNNING",
      ...extra,
    },
  });
}

export async function listDomainMigrations(limit = 40) {
  return prisma.domainMigration.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      domain: { select: { id: true, name: true } },
      sourceServer: { select: { id: true, name: true, hostname: true } },
      destServer: { select: { id: true, name: true, hostname: true } },
    },
  });
}

export async function migrateDomainToServer(input: {
  domainId: string;
  destServerId: string;
}) {
  const domain = await prisma.domain.findUniqueOrThrow({
    where: { id: input.domainId },
    include: {
      server: true,
      subdomains: true,
      postgresDatabases: { where: { isActive: true } },
    },
  });
  if (isPanelHostname(domain.name)) {
    throw new Error("The panel hostname cannot be migrated off this controller node");
  }
  if (domain.serverId === input.destServerId) {
    throw new Error("Domain is already on that server");
  }
  const dest = await prisma.server.findUniqueOrThrow({
    where: { id: input.destServerId },
  });
  assertAgentTarget(dest);
  const sourceTarget = await agentTargetForServerId(domain.serverId);
  const destTarget = await agentTargetForServerId(dest.id);
  const config = await getOrCreateBackupConfig();

  const running = await prisma.domainMigration.findFirst({
    where: { domainId: domain.id, status: { in: ["PENDING", "RUNNING"] } },
  });
  if (running) {
    throw new Error("A migration is already running for this domain");
  }

  const migration = await prisma.domainMigration.create({
    data: {
      domainId: domain.id,
      sourceServerId: domain.serverId,
      destServerId: dest.id,
      status: "RUNNING",
      step: 1,
      stepLabel: STEPS[0],
    },
  });

  try {
    await setStep(migration.id, 1);
    await setStep(migration.id, 2);
    const databases = domain.postgresDatabases.map((db) => ({
      dbName: db.dbName,
      roleName: db.roleName,
      domain: domain.name,
    }));
    const backup = await callAgent<{ archivePath?: string }>(
      {
        action: "run_domain_backup",
        domain: domain.name,
        backupRoot: config.backupRoot,
        retainCount: config.retainCount,
        includeSites: true,
        includeDns: true,
        includeMail: true,
        includeDatabases: true,
        databases,
      },
      sourceTarget
    );
    if (!backup.success || !backup.data?.archivePath) {
      throw new Error(backup.error ?? "Export on the source node failed");
    }
    await setStep(migration.id, 3, { archivePath: backup.data.archivePath });

    const downloaded = await downloadBackupFromAgent({
      target: sourceTarget,
      archivePath: backup.data.archivePath,
      allowedRoot: config.backupRoot,
    });
    if (!downloaded.success || !downloaded.data?.content) {
      throw new Error(downloaded.error ?? "Could not download the export from the source agent");
    }

    const uploaded = await uploadBackupToAgent({
      target: destTarget,
      fileName: downloaded.data.fileName,
      content: downloaded.data.content,
      allowedRoot: config.backupRoot,
    });
    const destArchive = uploaded.data?.archivePath;
    if (!uploaded.success || !destArchive) {
      throw new Error(uploaded.error ?? "Could not upload the archive to the target agent");
    }

    await setStep(migration.id, 4, { archivePath: destArchive });
    const restored = await callAgent(
      {
        action: "restore_domain_backup",
        archivePath: destArchive,
        allowedRoot: config.backupRoot,
        domain: domain.name,
        restoreSites: true,
        restoreDns: true,
        restoreMail: true,
        restoreDatabases: true,
      },
      destTarget
    );
    if (!restored.success) {
      throw new Error(restored.error ?? "Import on the target node failed");
    }

    await setStep(migration.id, 5);
    const created = await callAgent(
      {
        action: "create_domain",
        domain: domain.name,
        documentRoot: domain.documentRoot,
        phpEnabled: phpEnabledForAppType(domain.appType),
        appType: domain.appType,
        upstreamPort: domain.upstreamPort,
      },
      destTarget
    );
    if (!created.success) {
      throw new Error(created.error ?? "Failed to rebuild nginx on the target node");
    }
    if (domain.appType !== "STATIC" && domain.appType !== "PHP") {
      await callAgent(
        {
          action: "configure_site_app",
          siteId: domain.id,
          siteName: domain.name,
          documentRoot: domain.documentRoot,
          appType: domain.appType,
          startCommand: domain.startCommand ?? undefined,
          appWorkingDir: domain.appWorkingDir,
          appEnv: domain.appEnv,
          upstreamPort: domain.upstreamPort,
          isSubdomain: false,
        },
        destTarget
      );
    }
    for (const sub of domain.subdomains) {
      await callAgent(
        {
          action: "create_subdomain",
          domain: domain.name,
          subdomain: sub.name,
          documentRoot: sub.documentRoot,
          phpEnabled: phpEnabledForAppType(sub.appType),
          appType: sub.appType,
          upstreamPort: sub.upstreamPort,
        },
        destTarget
      );
    }

    await setStep(migration.id, 6);
    const ssl = await callAgent(
      {
        action: "issue_ssl",
        domain: domain.name,
        subdomains: ["www"],
        documentRoot: domain.documentRoot,
        phpEnabled: phpEnabledForAppType(domain.appType),
        appType: domain.appType,
        upstreamPort: domain.upstreamPort,
      },
      destTarget
    );
    if (!ssl.success) {
      console.warn("Migration SSL on target failed:", ssl.error);
    }

    await setStep(migration.id, 7);
    const ping = await callAgent({ action: "ping" }, destTarget);
    if (!ping.success) {
      throw new Error(ping.error ?? "Target agent health check failed");
    }

    await setStep(migration.id, 8);
    await prisma.domain.update({
      where: { id: domain.id },
      data: { serverId: dest.id },
    });

    await setStep(migration.id, 9);
    const removed = await callAgent(
      { action: "delete_domain", domain: domain.name },
      sourceTarget
    );
    if (!removed.success) {
      console.warn("Could not deprovision source nginx:", removed.error);
    }

    const done = await prisma.domainMigration.update({
      where: { id: migration.id },
      data: {
        status: "COMPLETED",
        step: 9,
        stepLabel: STEPS[8],
        finishedAt: new Date(),
        lastError: null,
      },
    });

    notifyMigration({
      domain: domain.name,
      detail: `Migrated ${domain.name} from ${domain.server.hostname} to ${dest.hostname}. Archive: ${destArchive}. Point DNS at the destination if it is not already.`,
    });

    return done;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    await prisma.domainMigration.update({
      where: { id: migration.id },
      data: {
        status: "FAILED",
        lastError: message,
        finishedAt: new Date(),
      },
    });
    notifyMigration({
      domain: domain.name,
      failed: true,
      detail: `Migration of ${domain.name} failed: ${message}`,
    });
    throw error;
  }
}
