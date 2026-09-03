import { prisma } from "@/lib/prisma";
import { collectResourceReport } from "@/lib/system/resources";
import { collectDiskReport } from "@/lib/system/disk";

const MAX_SAMPLES = 400;

export async function recordAndListMonitoring() {
  const [report, disk] = await Promise.all([
    collectResourceReport(),
    collectDiskReport({}),
  ]);

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

  const extra = await prisma.resourceSample.count();
  if (extra > MAX_SAMPLES) {
    const stale = await prisma.resourceSample.findMany({
      orderBy: { collectedAt: "asc" },
      take: extra - MAX_SAMPLES,
      select: { id: true },
    });
    if (stale.length) {
      await prisma.resourceSample.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }

  const history = await prisma.resourceSample.findMany({
    orderBy: { collectedAt: "asc" },
    take: MAX_SAMPLES,
  });

  return { report, disk, history };
}
