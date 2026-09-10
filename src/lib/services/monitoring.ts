import { prisma } from "@/lib/prisma";
import { collectResourceReport } from "@/lib/system/resources";
import { collectDiskReport } from "@/lib/system/disk";

/** Charts and retention cover the last 48 hours. */
const HISTORY_MS = 48 * 60 * 60 * 1000;
/** Store at most one sample per minute while the monitoring page is open. */
const MIN_SAMPLE_INTERVAL_MS = 60 * 1000;
/** Safety cap (~48h at 1/min + buffer). */
const MAX_SAMPLES = 3000;

export async function recordAndListMonitoring() {
  const [report, disk] = await Promise.all([
    collectResourceReport(),
    collectDiskReport({}),
  ]);

  const cutoff = new Date(Date.now() - HISTORY_MS);
  const latest = await prisma.resourceSample.findFirst({
    orderBy: { collectedAt: "desc" },
    select: { collectedAt: true },
  });
  const shouldInsert =
    !latest ||
    Date.now() - latest.collectedAt.getTime() >= MIN_SAMPLE_INTERVAL_MS;

  if (shouldInsert) {
    await prisma.resourceSample.create({
      data: {
        hostname: report.hostname,
        cpuPercent: report.cpu.percent,
        memPercent: report.memory.percent,
        load1: report.cpu.loadAvg?.[0] ?? null,
        memUsedBytes: report.memory.usedBytes,
        memTotalBytes: report.memory.totalBytes,
      },
    });
  }

  await prisma.resourceSample.deleteMany({
    where: { collectedAt: { lt: cutoff } },
  });

  const count = await prisma.resourceSample.count();
  if (count > MAX_SAMPLES) {
    const stale = await prisma.resourceSample.findMany({
      orderBy: { collectedAt: "asc" },
      take: count - MAX_SAMPLES,
      select: { id: true },
    });
    if (stale.length) {
      await prisma.resourceSample.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }

  const history = await prisma.resourceSample.findMany({
    where: { collectedAt: { gte: cutoff } },
    orderBy: { collectedAt: "asc" },
    take: MAX_SAMPLES,
  });

  return { report, disk, history, windowHours: 48 };
}
