"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, HardDrive, MemoryStick, Cpu } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

function formatDiskBytes(n: number | null | undefined): string {
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

type Report = {
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
  hostname: string;
};

type Sample = {
  collectedAt: string;
  cpuPercent: number | null;
  memPercent: number | null;
};

type DiskReport = {
  volumes: Array<{
    mount: string;
    filesystem: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
  }>;
  paths: Array<{ id: string; label: string; path: string; bytes: number | null }>;
};

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) {
    return <p className="text-xs text-slate-500">Collecting samples…</p>;
  }
  const w = 320;
  const h = 64;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full">
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
    </svg>
  );
}

export default function MonitoringPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [disk, setDisk] = useState<DiskReport | null>(null);
  const [history, setHistory] = useState<Sample[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/system/monitoring", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to load");
      return;
    }
    setError("");
    setReport(data.report);
    setDisk(data.disk);
    setHistory(data.history ?? []);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const cpuSeries = useMemo(
    () => history.map((s) => Number(s.cpuPercent ?? 0)),
    [history]
  );
  const memSeries = useMemo(
    () => history.map((s) => Number(s.memPercent ?? 0)),
    [history]
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Resource Monitoring" description="CPU, RAM, and disk on this panel host" />
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-emerald-400" /> CPU
          </p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {report?.cpu.percent == null ? "—" : `${report.cpu.percent}%`}
          </p>
          <p className="text-[11px] text-slate-500">
            {report ? `${report.cpu.cores} cores · ${report.hostname}` : "…"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <MemoryStick className="h-3.5 w-3.5 text-violet-400" /> RAM
          </p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {report?.memory.percent == null ? "—" : `${report.memory.percent}%`}
          </p>
          <p className="text-[11px] text-slate-500">
            {report
              ? `${formatDiskBytes(report.memory.usedBytes)} / ${formatDiskBytes(report.memory.totalBytes)}`
              : "…"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Activity className="h-3.5 w-3.5 text-emerald-400" /> Load
          </p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {report?.cpu.loadAvg
              ? report.cpu.loadAvg.map((n) => n.toFixed(2)).join(" / ")
              : "—"}
          </p>
          <p className="text-[11px] text-slate-500">1 / 5 / 15 min</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="mb-2 text-xs font-medium text-slate-300">CPU history</p>
          <Sparkline values={cpuSeries} color="#38bdf8" />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="mb-2 text-xs font-medium text-slate-300">RAM history</p>
          <Sparkline values={memSeries} color="#a78bfa" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-white">
          <HardDrive className="h-4 w-4 text-slate-400" />
          Disk volumes
        </p>
        <div className="space-y-3">
          {(disk?.volumes ?? []).map((v) => {
            const pct =
              v.totalBytes > 0
                ? Math.round((v.usedBytes / v.totalBytes) * 1000) / 10
                : 0;
            return (
              <div key={v.mount}>
                <div className="flex justify-between text-xs text-slate-400">
                  <span className="font-mono">{v.mount}</span>
                  <span>
                    {formatDiskBytes(v.usedBytes)} / {formatDiskBytes(v.totalBytes)} ({pct}%)
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
          {(disk?.volumes ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No volume data.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
