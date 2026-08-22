import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { agentTargetForServerId, controllerAgentTarget } from "@/lib/agent/target";
import { assertValidIpAddress, sanitizeBlockReason } from "@/lib/ip";
import {
  analyzeThreats,
  lookupGeo,
  parseUserAgent,
  type ThreatFinding,
} from "@/lib/security/threat-detector";
import type { ThreatSeverity, ThreatType } from "@/generated/prisma/client";

type AccessRole = "ADMIN" | "USER";

/** Admins can see all domains; others only their own. */
function domainOwnerFilter(userId: string, role?: AccessRole) {
  return role === "ADMIN" ? {} : { userId };
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
  const owner = domainOwnerFilter(userId, role);
  const domainFilter = domainId
    ? { domainId, domain: owner }
    : { domain: owner };
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [visitorsToday, uniqueToday, threatsToday, blockedIps, liveNow, domains] = await Promise.all([
    prisma.visitorLog.count({ where: { ...domainFilter, visitedAt: { gte: since } } }),
    prisma.visitorLog.groupBy({
      by: ["ipAddress"],
      where: { ...domainFilter, visitedAt: { gte: since } },
    }).then((r) => r.length),
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
  ]);

  return { visitorsToday, uniqueToday, threatsToday, blockedIps, liveNow, domains };
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
  const visitorLogExists = fs.existsSync(log);
  const visitorLogBytes = visitorLogExists ? fs.statSync(log).size : 0;
  const timerState = (timer.stdout || "").trim() || "inactive";
  let hint = "Visitor ingest is running. New site hits appear within about a minute.";
  if (timerState !== "active") {
    hint =
      "Ingest timer is not active. Re-run the panel installer as root, or: sudo bash scripts/install-visitor-ingest.sh";
  } else if (!visitorLogExists) {
    hint = "nginx visitor log is missing. Reload nginx after enabling ingest.";
  } else if (visitorLogBytes === 0) {
    hint =
      "Ingest is on, but nginx has not logged a site hit yet. Open a hosted domain (not only this panel page).";
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
) {
  const limit = Math.min(opts.limit ?? 100, 5000);
  const owner = domainOwnerFilter(userId, opts.role);
  return prisma.visitorLog.findMany({
    where: {
      domain: owner,
      ...(opts.domainId ? { domainId: opts.domainId } : {}),
      ...(opts.from || opts.to
        ? {
            visitedAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
      ...(opts.search
        ? {
            OR: [
              { ipAddress: { contains: opts.search } },
              { url: { contains: opts.search } },
              { browser: { contains: opts.search } },
            ],
          }
        : {}),
    },
    include: { domain: { select: { name: true } } },
    orderBy: { visitedAt: "desc" },
    take: limit,
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

  const visitor = await prisma.visitorLog.create({
    data: {
      domainId: domain.id,
      ipAddress: input.ipAddress,
      url: input.url,
      method: input.method ?? "GET",
      userAgent: input.userAgent,
      browser: parsed.browser,
      os: parsed.os,
      countryCode: geo.countryCode,
      countryName: geo.countryName,
      referrer: input.referrer,
      statusCode: input.statusCode ?? 200,
      isBot,
    },
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

  return { visitorId: visitor.id, threats: findings.length, blocked: autoBlocked };
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
}

export async function addWhitelist(ip: string, label?: string) {
  const safeIp = assertValidIpAddress(ip);
  const safeLabel = label
    ? sanitizeBlockReason(label, 120)
    : undefined;
  return prisma.whitelistedIp.create({
    data: { ipAddress: safeIp, label: safeLabel },
  });
}

export async function removeWhitelist(id: string) {
  return prisma.whitelistedIp.delete({ where: { id } });
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
