import { pingAgent } from "@/lib/agent/client";
import {
  controllerAgentTarget,
  defaultControllerAgentUrl,
} from "@/lib/agent/target";
import { evaluateAndNotifyHostAlerts } from "@/lib/mail/admin-alerts";
import { collectDiskReport, formatDiskBytes } from "@/lib/system/disk";
import { collectResourceReport } from "@/lib/system/resources";

/** Collect controller host metrics and send admin alerts (cron / worker). */
export async function runScheduledHostAlerts() {
  const [health, disk, agentOnline] = await Promise.all([
    collectResourceReport(),
    collectDiskReport({}),
    pingAgent(await controllerAgentTarget()),
  ]);

  const volume = disk.volumes[0] ?? null;
  const diskPercent =
    volume && volume.totalBytes > 0
      ? Math.min(
          100,
          Math.round((volume.usedBytes / volume.totalBytes) * 1000) / 10
        )
      : null;

  await evaluateAndNotifyHostAlerts({
    hostname: health.hostname,
    cpuPercent: health.cpu.percent,
    memPercent: health.memory.percent,
    load1: health.cpu.loadAvg?.[0] ?? null,
    cores: health.cpu.cores,
    diskPercent,
    diskLabel: volume
      ? `${formatDiskBytes(volume.usedBytes)} / ${formatDiskBytes(volume.totalBytes)}`
      : undefined,
    agentOnline,
    agentUrl: defaultControllerAgentUrl(),
  });

  return {
    hostname: health.hostname,
    cpuPercent: health.cpu.percent,
    memPercent: health.memory.percent,
    diskPercent,
    agentOnline,
  };
}
