import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import {
  assertAgentTarget,
  defaultControllerAgentUrl,
  ensureControllerNode,
} from "@/lib/agent/target";
import { coerceResellerRoles } from "@/lib/services/users";

function assertHttpUrl(raw: string) {
  const url = raw.trim().replace(/\/$/, "");
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Agent URL must be a valid http(s) address");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Agent URL must be http or https");
  }
  return url;
}

export async function listFleetServers() {
  await coerceResellerRoles();
  await ensureControllerNode();
  return prisma.server.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { domains: true } } },
  });
}

export function publicServerRow(
  server: Awaited<ReturnType<typeof listFleetServers>>[number]
) {
  const key = server.agentKey || "";
  return {
    id: server.id,
    name: server.name,
    hostname: server.hostname,
    ipAddress: server.ipAddress,
    agentUrl: server.agentUrl,
    notes: server.notes,
    isActive: server.isActive,
    lastSeenAt: server.lastSeenAt,
    lastPingError: server.lastPingError,
    domainCount: server._count.domains,
    agentKeyHint: key.length > 4 ? `••••${key.slice(-4)}` : "••••",
    createdAt: server.createdAt,
  };
}

export async function createFleetServer(input: {
  name: string;
  hostname: string;
  ipAddress: string;
  agentUrl?: string;
  agentKey?: string;
  notes?: string;
}) {
  const hostname = input.hostname.trim().toLowerCase();
  const count = await prisma.server.count();
  const agentKey =
    input.agentKey?.trim() || randomBytes(24).toString("hex");
  const agentUrl = input.agentUrl
    ? assertHttpUrl(input.agentUrl)
    : count === 0
      ? defaultControllerAgentUrl()
      : null;
  if (count > 0 && !agentUrl) {
    throw new Error("Agent URL is required for additional servers");
  }
  return prisma.server.create({
    data: {
      name: input.name.trim() || hostname,
      hostname,
      ipAddress: input.ipAddress.trim(),
      agentUrl,
      agentKey,
      notes: input.notes?.trim() || null,
      isActive: true,
    },
  });
}

export async function updateFleetServer(
  id: string,
  input: {
    name?: string;
    hostname?: string;
    ipAddress?: string;
    agentUrl?: string | null;
    agentKey?: string;
    notes?: string | null;
    isActive?: boolean;
  }
) {
  if (input.agentUrl !== undefined && !String(input.agentUrl).trim()) {
    throw new Error("Agent URL is required");
  }
  return prisma.server.update({
    where: { id },
    data: {
      ...(input.name != null ? { name: input.name.trim() } : {}),
      ...(input.hostname != null
        ? { hostname: input.hostname.trim().toLowerCase() }
        : {}),
      ...(input.ipAddress != null ? { ipAddress: input.ipAddress.trim() } : {}),
      ...(input.agentUrl !== undefined
        ? { agentUrl: assertHttpUrl(String(input.agentUrl)) }
        : {}),
      ...(input.agentKey?.trim() ? { agentKey: input.agentKey.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.isActive != null ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deleteFleetServer(id: string) {
  const server = await prisma.server.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { domains: true } } },
  });
  const total = await prisma.server.count();
  if (total <= 1) {
    throw new Error("Cannot delete the last server");
  }
  if (server._count.domains > 0) {
    throw new Error("Move or delete this server’s domains first");
  }
  await prisma.server.delete({ where: { id } });
}

export async function pingFleetServer(id: string) {
  await ensureControllerNode();
  const server = await prisma.server.findUniqueOrThrow({ where: { id } });
  const target = assertAgentTarget(server);
  const result = await callAgent({ action: "ping" }, target);

  if (!result.success) {
    await prisma.server.update({
      where: { id },
      data: { lastPingError: result.error ?? "Unreachable", isActive: server.isActive },
    });
    throw new Error(result.error ?? "Agent ping failed");
  }

  await prisma.server.update({
    where: { id },
    data: { lastSeenAt: new Date(), lastPingError: null },
  });
  return result.data;
}
