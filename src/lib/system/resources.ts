import fs from "node:fs/promises";
import os from "node:os";

export type ResourceReport = {
  collectedAt: string;
  cpu: {
    percent: number | null;
    cores: number;
    model: string | null;
    loadAvg: [number, number, number] | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    percent: number | null;
  };
  uptimeSeconds: number;
  platform: string;
  hostname: string;
};

function cpuTimesSnapshot(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

async function sampleCpuPercent(sampleMs = 250): Promise<number | null> {
  const a = cpuTimesSnapshot();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = cpuTimesSnapshot();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  if (totalDelta <= 0) return null;
  const busy = 1 - idleDelta / totalDelta;
  return Math.max(0, Math.min(100, Math.round(busy * 1000) / 10));
}

async function linuxMemAvailableBytes(): Promise<number | null> {
  if (process.platform === "win32") return null;
  try {
    const raw = await fs.readFile("/proc/meminfo", "utf8");
    const avail = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(raw);
    if (avail?.[1]) return Number(avail[1]) * 1024;
    const free = /^MemFree:\s+(\d+)\s+kB$/m.exec(raw);
    const buffers = /^Buffers:\s+(\d+)\s+kB$/m.exec(raw);
    const cached = /^Cached:\s+(\d+)\s+kB$/m.exec(raw);
    if (free?.[1]) {
      return (
        (Number(free[1]) +
          Number(buffers?.[1] ?? 0) +
          Number(cached?.[1] ?? 0)) *
        1024
      );
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function collectResourceReport(): Promise<ResourceReport> {
  const [cpuPercent, memAvailable] = await Promise.all([
    sampleCpuPercent(250),
    linuxMemAvailableBytes(),
  ]);

  const totalBytes = os.totalmem();
  const availableBytes =
    memAvailable != null && Number.isFinite(memAvailable)
      ? Math.min(totalBytes, Math.max(0, memAvailable))
      : os.freemem();
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const memPercent =
    totalBytes > 0
      ? Math.max(0, Math.min(100, Math.round((usedBytes / totalBytes) * 1000) / 10))
      : null;

  const load = os.loadavg();
  const loadAvg =
    process.platform === "win32"
      ? null
      : ([load[0] ?? 0, load[1] ?? 0, load[2] ?? 0] as [number, number, number]);

  const cpus = os.cpus();
  return {
    collectedAt: new Date().toISOString(),
    cpu: {
      percent: cpuPercent,
      cores: cpus.length || 1,
      model: cpus[0]?.model?.trim() || null,
      loadAvg,
    },
    memory: {
      totalBytes,
      usedBytes,
      availableBytes,
      percent: memPercent,
    },
    uptimeSeconds: Math.floor(os.uptime()),
    platform: process.platform,
    hostname: os.hostname(),
  };
}

export function formatMemBytes(n: number | null | undefined): string {
  if (n == null || n < 0 || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
