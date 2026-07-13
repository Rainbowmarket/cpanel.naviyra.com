import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import {
  analyzeThreats,
  lookupGeo,
  parseUserAgent,
  type ThreatFinding,
} from "@/lib/security/threat-detector";
import type { ThreatSeverity, ThreatType } from "@/generated/prisma/client";

const LIVE_TTL_MS = 5 * 60 * 1000;
const AUTO_BLOCK_THRESHOLD = Number(process.env.AUTO_BLOCK_THRESHOLD ?? 5);
const AUTO_BLOCK_WINDOW_MS = Number(process.env.AUTO_BLOCK_WINDOW_MINUTES ?? 15) * 60 * 1000;

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

export async function getSecurityOverview(userId: string, domainId?: string) {
  const domainFilter = domainId ? { domainId, domain: { userId } } : { domain: { userId } };
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
        ...(domainId ? { domainId, domain: { userId } } : { domain: { userId } }),
      },
    }),
    prisma.blockedIp.count({ where: { isActive: true } }),
    prisma.liveVisitor.count({
      where: {
        lastSeen: { gte: new Date(Date.now() - LIVE_TTL_MS) },
        ...(domainId ? { domainId, domain: { userId } } : { domain: { userId } }),
      },
    }),
    prisma.domain.count({ where: { userId, status: "ACTIVE" } }),
  ]);

  return { visitorsToday, uniqueToday, threatsToday, blockedIps, liveNow, domains };
}

export async function listLiveVisitors(userId: string, domainId?: string) {
  await purgeStaleLive();
  return prisma.liveVisitor.findMany({
    where: {
      lastSeen: { gte: new Date(Date.now() - LIVE_TTL_MS) },
      domain: { userId },
      ...(domainId ? { domainId } : {}),
    },
    include: { domain: { select: { name: true } } },
    orderBy: { lastSeen: "desc" },
    take: 100,
  });
}

export async function listVisitors(userId: string, opts: { domainId?: string; search?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 100, 500);
  return prisma.visitorLog.findMany({
    where: {
      domain: { userId },
      ...(opts.domainId ? { domainId: opts.domainId } : {}),
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

export async function listSecurityEvents(userId: string, domainId?: string, limit = 50) {
  return prisma.securityEvent.findMany({
    where: {
      domain: { userId },
      ...(domainId ? { domainId } : {}),
    },
    include: { domain: { select: { name: true } } },
    orderBy: { detectedAt: "desc" },
    take: limit,
  });
}

export async function listBlockedIps() {
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
        actionTaken:
          finding.severity === "high" || finding.severity === "critical"
            ? "BLOCKED_AUTO"
            : "LOGGED",
      },
    });

    if (finding.severity === "high" || finding.severity === "critical") {
      autoBlocked = (await maybeAutoBlock(input.ipAddress, finding, event.id, domain.server.agentKey)) || autoBlocked;
    }
  }

  return { visitorId: visitor.id, threats: findings.length, blocked: autoBlocked };
}

async function maybeAutoBlock(
  ip: string,
  finding: ThreatFinding,
  eventId: string,
  agentKey: string
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
    await blockIp(ip, `Auto-block: ${finding.type} (${finding.severity})`, "auto", eventId, agentKey);
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
  agentKey?: string
) {
  const whitelisted = await prisma.whitelistedIp.findUnique({ where: { ipAddress: ip } });
  if (whitelisted) throw new Error("IP is whitelisted");

  await prisma.blockedIp.upsert({
    where: { ipAddress: ip },
    create: { ipAddress: ip, reason, source, securityEventId, blockedVia: "ufw" },
    update: { reason, source, securityEventId, isActive: true, blockedAt: new Date() },
  });

  await callAgent({ action: "block_ip", ip, reason }, agentKey);
}

export async function unblockIp(ip: string, agentKey?: string) {
  await prisma.blockedIp.updateMany({
    where: { ipAddress: ip },
    data: { isActive: false },
  });
  await callAgent({ action: "unblock_ip", ip }, agentKey);
}

export async function addWhitelist(ip: string, label?: string) {
  return prisma.whitelistedIp.create({ data: { ipAddress: ip, label } });
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
