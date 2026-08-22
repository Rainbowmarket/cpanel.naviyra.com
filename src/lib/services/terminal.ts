import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { resolveHostingTarget } from "@/lib/hosting-targets";
import {
  buildTerminalWsUrl,
  signTerminalToken,
  type TerminalTokenClaims,
} from "@/lib/terminal/token";

const TOKEN_TTL_SEC = 10 * 60;

export async function createTerminalSession(
  user: SessionUser,
  targetId?: string
) {
  // "jail" mode is not OS containment — Terminal is admin-only until real isolation exists.
  if (user.role !== "ADMIN") {
    throw new Error("Terminal is available to administrators only");
  }

  const twoFactor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { twoFactorEnabled: true },
  });
  if (!twoFactor?.twoFactorEnabled) {
    throw new Error(
      "Enable two-factor authentication in Account security before using Terminal"
    );
  }

  let mode: "full" | "jail";
  let cwd: string;
  let targetLabel: string | null = null;
  let dbMode: "FULL" | "JAIL";

  if (!targetId) {
    mode = "full";
    dbMode = "FULL";
    cwd = process.platform === "win32" ? process.cwd() : "/";
    targetLabel = "Server root";
  } else {
    const target = await resolveHostingTarget(
      targetId,
      { id: user.id, role: user.role },
      { excludeMailSubdomains: true }
    );
    mode = "jail";
    dbMode = "JAIL";
    cwd = target.documentRoot;
    targetLabel = target.label;
  }

  const session = await prisma.terminalSession.create({
    data: {
      userId: user.id,
      mode: dbMode,
      cwd,
      targetLabel,
    },
  });

  const claims: TerminalTokenClaims = {
    sid: session.id,
    uid: user.id,
    mode,
    cwd,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  };
  const token = signTerminalToken(claims);
  const wsBase = buildTerminalWsUrl();
  const wsUrl = `${wsBase}${wsBase.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;

  await prisma.terminalSessionLog.create({
    data: {
      sessionId: session.id,
      kind: "SYS",
      text: `Session started (${mode}) cwd=${cwd}`,
    },
  });

  return {
    sessionId: session.id,
    token,
    wsUrl,
    mode,
    cwd,
    targetLabel,
  };
}

export async function listTerminalSessions(userId: string, limit = 20) {
  return prisma.terminalSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      mode: true,
      cwd: true,
      targetLabel: true,
      createdAt: true,
      endedAt: true,
    },
  });
}

export async function appendTerminalLogs(
  userId: string,
  sessionId: string,
  lines: Array<{ at?: string; kind: "cmd" | "out" | "sys"; text: string }>
) {
  const session = await prisma.terminalSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!session) {
    throw new Error("Terminal session not found");
  }

  const kindMap = { cmd: "CMD", out: "OUT", sys: "SYS" } as const;
  await prisma.terminalSessionLog.createMany({
    data: lines
      .filter((l) => l.text?.trim())
      .slice(0, 100)
      .map((l) => ({
        sessionId,
        kind: kindMap[l.kind],
        text: l.text.slice(0, 8000),
        at: l.at ? new Date(l.at) : new Date(),
      })),
  });

  return { ok: true };
}

export async function getTerminalLogs(userId: string, sessionId: string) {
  const session = await prisma.terminalSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!session) {
    throw new Error("Terminal session not found");
  }

  return prisma.terminalSessionLog.findMany({
    where: { sessionId },
    orderBy: { at: "asc" },
    take: 500,
    select: { id: true, at: true, kind: true, text: true },
  });
}

export async function endTerminalSession(userId: string, sessionId: string) {
  const session = await prisma.terminalSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!session) return;
  await prisma.terminalSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });
  await prisma.terminalSessionLog.create({
    data: {
      sessionId,
      kind: "SYS",
      text: "Session ended",
    },
  });
}
