import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId } from "@/lib/agent/target";
import { listSiteApps } from "@/lib/services/apps";
import type { AccessActor } from "@/lib/hosting-targets";

type Actor = AccessActor | string;

function asActor(user: Actor): AccessActor {
  return typeof user === "string" ? { id: user, role: "USER" } : user;
}

export async function listGitDeployments(user: Actor) {
  const actor = asActor(user);
  const sites = await listSiteApps(actor);
  const rows = await prisma.gitDeployment.findMany();
  const byKey = new Map(rows.map((r) => [`${r.kind}:${r.siteId}`, r]));
  return sites.map((site) => {
    const saved = byKey.get(`${site.kind}:${site.id}`);
    return {
      kind: site.kind,
      id: site.id,
      hostname: site.hostname,
      documentRoot: site.documentRoot,
      repoUrl: saved?.repoUrl ?? "",
      branch: saved?.branch ?? "main",
      lastCommit: saved?.lastCommit ?? null,
      lastStatus: saved?.lastStatus ?? "idle",
      lastError: saved?.lastError ?? null,
      lastDeployAt: saved?.lastDeployAt ?? null,
    };
  });
}

export async function saveAndDeployGit(input: {
  user: Actor;
  kind: "domain" | "subdomain";
  id: string;
  repoUrl: string;
  branch?: string;
}) {
  const sites = await listSiteApps(input.user);
  const site = sites.find((s) => s.kind === input.kind && s.id === input.id);
  if (!site) throw new Error("Site not found");

  const repoUrl = input.repoUrl.trim();
  const branch = (input.branch || "main").trim() || "main";
  const saved = await prisma.gitDeployment.upsert({
    where: {
      kind_siteId: { kind: input.kind, siteId: input.id },
    },
    create: {
      kind: input.kind,
      siteId: input.id,
      hostname: site.hostname,
      repoUrl,
      branch,
      lastStatus: "running",
      lastError: null,
    },
    update: {
      hostname: site.hostname,
      repoUrl,
      branch,
      lastStatus: "running",
      lastError: null,
    },
  });

  const result = await callAgent<{
    commit?: string | null;
    action?: string;
    dryRun?: boolean;
  }>(
    {
      action: "git_deploy",
      documentRoot: site.documentRoot,
      repoUrl,
      branch,
    },
    await agentTargetForServerId(site.serverId)
  );

  if (!result.success) {
    await prisma.gitDeployment.update({
      where: { id: saved.id },
      data: {
        lastStatus: "failed",
        lastError: result.error ?? "Deploy failed",
        lastDeployAt: new Date(),
      },
    });
    throw new Error(result.error ?? "Git deploy failed");
  }

  const updated = await prisma.gitDeployment.update({
    where: { id: saved.id },
    data: {
      lastStatus: result.data?.dryRun ? "dry-run" : "success",
      lastError: null,
      lastCommit: result.data?.commit ?? null,
      lastDeployAt: new Date(),
    },
  });

  return updated;
}
