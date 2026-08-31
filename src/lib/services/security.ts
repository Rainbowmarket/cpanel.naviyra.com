import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId, controllerAgentTarget } from "@/lib/agent/target";
import { assertValidIpAddress, sanitizeBlockReason } from "@/lib/ip";
import { syncBlocklistToSecurityManager } from "@/lib/services/security-manager-sync";
import {
  analyzeThreats,
  lookupGeo,
  parseUserAgent,
  type ThreatFinding,
} from "@/lib/security/threat-detector";
import { migrateLegacyVisitorLogsIfNeeded } from "@/lib/visitors/migrate-legacy";
import {
  clampVisitorFromDate,
  countUniqueVisitorIps,
  countVisitorLogs,
  insertVisitorLog,
  listVisitorLogs,
  retentionCutoffMonth,
  visitorArchiveSummary,
  type VisitorListRow,
} from "@/lib/visitors/store";
import { domainAccessWhere } from "@/lib/hosting-targets";
import type { ThreatSeverity, ThreatType } from "@/generated/prisma/client";

type AccessRole = "ADMIN" | "USER";

/** Admins see all; owners and DomainAccess grantees with security see matching domains. */
function domainOwnerFilter(userId: string, role?: AccessRole) {
  return domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "security"
  );
}

function visitorStoreFilter(userId: string, role?: AccessRole, domainId?: string) {
  return {
    admin: role === "ADMIN",
    userId: role === "ADMIN" ? undefined : userId,
    domainId,
  };
}

async function ensureVisitorStoreReady() {
  await migrateLegacyVisitorLogsIfNeeded();
}

const LIVE_TTL_MS = 5 * 60 * 1000;
const AUTO_BLOCK_THRESHOLD = Number(process.env.AUTO_BLOCK_THRESHOLD ?? 5);
const AUTO_BLOCK_WINDOW_MS = Number(process.env.AUTO_BLOCK_WINDOW_MINUTES ?? 15) * 60 * 1000;
/** Auto-blocks expire after this many hours (manual blocks never expire). */
const AUTO_BLOCK_TTL_MS =
  Number(process.env.AUTO_BLOCK_TTL_HOURS ?? 48) * 60 * 60 * 1000;

export function autoBlockTtlMs(): number {
  return AUTO_BLOCK_TTL_MS;
}

export function autoBlockExpiresAt(blockedAt: Date | string): Date {
  const t = typeof blockedAt === "string" ? new Date(blockedAt) : blockedAt;
  return new Date(t.getTime() + AUTO_BLOCK_TTL_MS);
}

/**
 * Unblock auto-source IPs older than AUTO_BLOCK_TTL_HOURS (default 48h).
 * Manual blocks are left alone.
 */
export async function expireAutoBlocks(): Promise<{ expired: number; ips: string[] }> {
  const cutoff = new Date(Date.now() - AUTO_BLOCK_TTL_MS);
  const rows = await prisma.blockedIp.findMany({
    where: {
      isActive: true,
      source: "auto",
      blockedAt: { lt: cutoff },
    },
    select: { ipAddress: true },
  });

  const ips: string[] = [];
  for (const row of rows) {
    try {
      await unblockIp(row.ipAddress);
      ips.push(row.ipAddress);
    } catch (error) {
      console.error("[security] expire auto-block failed", row.ipAddress, error);
    }
  }
  return { expired: ips.length, ips };
}

function mapSeverity(s: ThreatFinding["severity"]): ThreatSeverity {
  const map = { low: "LOW", medium: "MEDIUM", high: "HIGH", critical: "CRITICAL" } as const;
  return map[s];
}

function mapType(t: string): ThreatType {
  const allowed: ThreatType[] = [
    "SQL_INJECTION",
    "XSS",
    "BRUTE_FORCE",
    "SCANNER",
    "BOT",
    "PATH_TRAVERSAL",
    "OTHER",
  ];
  return allowed.includes(t as ThreatType) ? (t as ThreatType) : "OTHER";
}

export async function getSecurityOverview(
  userId: string,
  domainId?: string,
  role?: AccessRole
) {
  await expireAutoBlocks();
  await ensureVisitorStoreReady();
  const owner = domainOwnerFilter(userId, role);
  const visitorFilter = visitorStoreFilter(userId, role, domainId);
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [visitorsToday, uniqueToday, threatsToday, blockedIps, liveNow, domains, visitorArchive] =
    await Promise.all([
      Promise.resolve(countVisitorLogs(visitorFilter, since)),
      Promise.resolve(countUniqueVisitorIps(visitorFilter, since)),
      prisma.securityEvent.count({
        where: {
          detectedAt: { gte: since },
          ...(domainId ? { domainId, domain: owner } : { domain: owner }),
        },
      }),
      prisma.blockedIp.count({ where: { isActive: true } }),
      prisma.liveVisitor.count({
        where: {
          lastSeen: { gte: new Date(Date.now() - LIVE_TTL_MS) },
          ...(domainId ? { domainId, domain: owner } : { domain: owner }),
        },
      }),
      prisma.domain.count({
        where: { status: "ACTIVE", ...owner },
      }),
      Promise.resolve(visitorArchiveSummary()),
    ]);

  return {
    visitorsToday,
    uniqueToday,
    threatsToday,
    blockedIps,
    liveNow,
    domains,
    visitorArchive,
  };
}

export function getVisitorIngestStatus() {
  if (process.platform !== "linux") {
    return {
      timer: "n/a",
      visitorLogExists: false,
      visitorLogBytes: 0,
      hint: "Visitor ingest runs on Linux with nginx.",
    };
  }
  const log = "/var/log/nginx/naviyra-visitors.log";
  const timer = spawnSync("systemctl", ["is-active", "naviyra-visitor-ingest.timer"], {
    encoding: "utf8",
  });
  const oneshot = spawnSync(
    "systemctl",
    ["show", "naviyra-visitor-ingest.service", "-p", "Result", "-p", "ExecMainStatus", "--value"],
    { encoding: "utf8" }
  );
  const visitorLogExists = fs.existsSync(log);
  const visitorLogBytes = visitorLogExists ? fs.statSync(log).size : 0;
  const timerState = (timer.stdout || "").trim() || "inactive";
  const oneshotOut = (oneshot.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  const oneshotResult = oneshotOut[0] || "";
  const oneshotStatus = oneshotOut[1] || "";
  let hint = "Visitor ingest is running. New site hits appear within about a minute.";
  if (timerState !== "active") {
    hint =
      "Ingest timer is not active. Start it from Admin → Services, or the Start ingest button on this page.";
  } else if (oneshotResult === "exit-code" || oneshotStatus === "203") {
    hint =
      "Ingest timer is on but the worker failed to start (systemd 203/EXEC). Re-run: sudo bash scripts/install-visitor-ingest.sh";
  } else if (!visitorLogExists) {
    hint = "nginx visitor log is missing. Reload nginx after enabling ingest.";
  } else if (visitorLogBytes === 0) {
    hint =
      "Ingest is on, but nginx has not logged a site hit yet. Open a hosted domain (not only this panel page).";
  } else {
    hint =
      "Visitor ingest is running. Open a customer site (not only hpanel) — panel /api traffic is ignored. New hits appear within about a minute.";
  }
  return { timer: timerState, visitorLogExists, visitorLogBytes, hint };
}

export async function listLiveVisitors(
  userId: string,
  domainId?: string,
  role?: AccessRole
) {
  await purgeStaleLive();
  const owner = domainOwnerFilter(userId, role);
  return prisma.liveVisitor.findMany({
    where: {
      lastSeen: { gte: new Date(Date.now() - LIVE_TTL_MS) },
      domain: owner,
      ...(domainId ? { domainId } : {}),
    },
    include: { domain: { select: { name: true } } },
    orderBy: { lastSeen: "desc" },
    take: 100,
  });
}

export async function listVisitors(
  userId: string,
  opts: {
    domainId?: string;
    search?: string;
    limit?: number;
    from?: Date;
    to?: Date;
    role?: AccessRole;
  }
): Promise<VisitorListRow[]> {
  await ensureVisitorStoreReady();
  const limit = Math.min(opts.limit ?? 100, 5000);
  const from =
    clampVisitorFromDate(opts.from) ??
    new Date(`${retentionCutoffMonth()}-01T00:00:00.000Z`);
  return listVisitorLogs({
    ...visitorStoreFilter(userId, opts.role, opts.domainId),
    search: opts.search,
    limit,
    from,
    to: opts.to,
  });
}

export async function listSecurityEvents(
  userId: string,
  domainId?: string,
  limit = 50,
  role?: AccessRole
) {
  const owner = domainOwnerFilter(userId, role);
  return prisma.securityEvent.findMany({
    where: {
      domain: owner,
      ...(domainId ? { domainId } : {}),
    },
    include: { domain: { select: { name: true } } },
    orderBy: { detectedAt: "desc" },
    take: limit,
  });
}

export async function listBlockedIps() {
  await expireAutoBlocks();
  return prisma.blockedIp.findMany({
    where: { isActive: true },
    orderBy: { blockedAt: "desc" },
  });
}

export async function listWhitelist() {
  return prisma.whitelistedIp.findMany({ orderBy: { createdAt: "desc" } });
}

export async function logVisit(input: {
  userId: string;
  domainId: string;
  ipAddress: string;
  url: string;
  method?: string;
  userAgent?: string;
  referrer?: string;
  statusCode?: number;
}) {
  const whitelisted = await prisma.whitelistedIp.findUnique({
    where: { ipAddress: input.ipAddress },
  });
  if (whitelisted) return { skipped: true, reason: "whitelisted" };

  await expireAutoBlocks();

  const blocked = await prisma.blockedIp.findFirst({
    where: { ipAddress: input.ipAddress, isActive: true },
  });
  if (blocked) return { skipped: true, reason: "blocked" };

  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: input.domainId, userId: input.userId },
    include: { server: true },
  });

  const parsed = parseUserAgent(input.userAgent);
  const geo = await lookupGeo(input.ipAddress);
  const findings = analyzeThreats(input.url, input.userAgent);
  const isBot = findings.some((f) => f.type === "BOT");

  await ensureVisitorStoreReady();
  const visitorId = insertVisitorLog({
    domainId: domain.id,
    domainName: domain.name,
    userId: domain.userId,
    ipAddress: input.ipAddress,
    url: input.url,
    method: input.method ?? "GET",
    userAgent: input.userAgent ?? null,
    browser: parsed.browser,
    os: parsed.os,
    countryCode: geo.countryCode,
    countryName: geo.countryName,
    referrer: input.referrer ?? null,
    statusCode: input.statusCode ?? 200,
    isBot,
    visitedAt: new Date(),
  });

  await prisma.liveVisitor.upsert({
    where: { domainId_ipAddress: { domainId: domain.id, ipAddress: input.ipAddress } },
    create: {
      domainId: domain.id,
      ipAddress: input.ipAddress,
      url: input.url,
      browser: parsed.browser,
      countryCode: geo.countryCode,
    },
    update: {
      url: input.url,
      browser: parsed.browser,
      countryCode: geo.countryCode,
      lastSeen: new Date(),
    },
  });

  let autoBlocked = false;
  for (const finding of findings) {
    const event = await prisma.securityEvent.create({
      data: {
        domainId: domain.id,
        ipAddress: input.ipAddress,
        threatType: mapType(finding.type),
        severity: mapSeverity(finding.severity),
        url: input.url,
        payload: finding.payload,
        userAgent: input.userAgent,
        statusCode: input.statusCode ?? null,
        actionTaken:
          finding.severity === "high" || finding.severity === "critical"
            ? "BLOCKED_AUTO"
            : "LOGGED",
      },
    });

    if (finding.severity === "high" || finding.severity === "critical") {
      autoBlocked = (await maybeAutoBlock(input.ipAddress, finding, event.id, domain.serverId)) || autoBlocked;
    }
  }

  return { visitorId, threats: findings.length, blocked: autoBlocked };
}

async function maybeAutoBlock(
  ip: string,
  finding: ThreatFinding,
  eventId: string,
  serverId: string
): Promise<boolean> {
  const since = new Date(Date.now() - AUTO_BLOCK_WINDOW_MS);
  const count = await prisma.securityEvent.count({
    where: {
      ipAddress: ip,
      severity: { in: ["HIGH", "CRITICAL"] },
      detectedAt: { gte: since },
    },
  });
  if (count < AUTO_BLOCK_THRESHOLD) return false;

  try {
    await blockIp(ip, `Auto-block: ${finding.type} (${finding.severity})`, "auto", eventId, serverId);
    return true;
  } catch {
    return false;
  }
}

export async function blockIp(
  ip: string,
  reason: string,
  source = "manual",
  securityEventId?: string,
  serverId?: string
) {
  const safeIp = assertValidIpAddress(ip);
  const safeReason = sanitizeBlockReason(reason);

  const whitelisted = await prisma.whitelistedIp.findUnique({
    where: { ipAddress: safeIp },
  });
  if (whitelisted) throw new Error("IP is whitelisted");

  await prisma.blockedIp.upsert({
    where: { ipAddress: safeIp },
    create: {
      ipAddress: safeIp,
      reason: safeReason,
      source,
      securityEventId,
      blockedVia: "ufw",
    },
    update: {
      reason: safeReason,
      source,
      securityEventId,
      isActive: true,
      blockedAt: new Date(),
    },
  });

  await callAgent(
    { action: "block_ip", ip: safeIp, reason: safeReason },
    serverId
      ? await agentTargetForServerId(serverId)
      : await controllerAgentTarget()
  );
  void syncBlocklistToSecurityManager({
    op: "block",
    ip: safeIp,
    reason: safeReason,
  });
}

export async function unblockIp(ip: string, serverId?: string) {
  const safeIp = assertValidIpAddress(ip);
  await prisma.blockedIp.updateMany({
    where: { ipAddress: safeIp },
    data: { isActive: false },
  });
  await callAgent(
    { action: "unblock_ip", ip: safeIp },
    serverId
      ? await agentTargetForServerId(serverId)
      : await controllerAgentTarget()
  );
  void syncBlocklistToSecurityManager({ op: "unblock", ip: safeIp });
}

export async function addWhitelist(ip: string, label?: string) {
  const safeIp = assertValidIpAddress(ip);
  const safeLabel = label
    ? sanitizeBlockReason(label, 120)
    : undefined;
  const row = await prisma.whitelistedIp.create({
    data: { ipAddress: safeIp, label: safeLabel },
  });
  void syncBlocklistToSecurityManager({
    op: "whitelist",
    ip: safeIp,
    label: safeLabel,
  });
  return row;
}

export async function removeWhitelist(id: string) {
  const row = await prisma.whitelistedIp.delete({ where: { id } });
  void syncBlocklistToSecurityManager({
    op: "unwhitelist",
    ip: row.ipAddress,
  });
  return row;
}

async function purgeStaleLive() {
  await prisma.liveVisitor.deleteMany({
    where: { lastSeen: { lt: new Date(Date.now() - LIVE_TTL_MS) } },
  });
}

export async function seedDemoVisit(userId: string) {
  const domain = await prisma.domain.findFirst({ where: { userId } });
  if (!domain) return null;
  return logVisit({
    userId,
    domainId: domain.id,
    ipAddress: "203.0.113.42",
    url: "/index.html",
    method: "GET",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
    statusCode: 200,
  });
}
