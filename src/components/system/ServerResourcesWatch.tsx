"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Cpu, MemoryStick, RefreshCw } from "lucide-react";

type ResourceReport = {
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

function formatMemBytes(n: number | null | undefined): string {
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

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function usedTone(pct: number | null) {
  if (pct == null) return "text-slate-400";
  if (pct >= 90) return "text-red-300";
  if (pct >= 75) return "text-amber-300";
  return "text-emerald-300";
}

function usedBar(pct: number | null) {
  if (pct == null) return "bg-slate-600";
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

const POLL_MS = 3000;

export function ServerResourcesWatch() {
  const [report, setReport] = useState<ResourceReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [watching, setWatching] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/system/resources", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setReport(data.report as ResourceReport);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!watching) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [watching, load]);

  const cpuPct = report?.cpu.percent ?? null;
  const memPct = report?.memory.percent ?? null;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-sky-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">Server load</h3>
            <p className="text-[11px] text-slate-500">
              Live CPU &amp; RAM
              {report
                ? ` · up ${formatUptime(report.uptimeSeconds)} · ${report.hostname}`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWatching((v) => !v)}
            className={`rounded-md border px-2 py-1 text-[10px] font-medium ${
              watching
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-slate-700 bg-slate-900 text-slate-400"
            }`}
          >
            {watching ? "Watching" : "Paused"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-900"
            title="Refresh now"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <Cpu className="h-3.5 w-3.5 text-sky-400" />
              CPU
            </div>
            <span className={`text-sm font-semibold tabular-nums ${usedTone(cpuPct)}`}>
              {cpuPct == null ? "—" : `${cpuPct}%`}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${usedBar(cpuPct)}`}
              style={{ width: `${cpuPct ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {report
              ? `${report.cpu.cores} core${report.cpu.cores === 1 ? "" : "s"}${
                  report.cpu.loadAvg
                    ? ` · load ${report.cpu.loadAvg.map((n) => n.toFixed(2)).join(" / ")}`
                    : ""
                }`
              : loading
                ? "Sampling…"
                : "Unavailable"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <MemoryStick className="h-3.5 w-3.5 text-violet-400" />
              RAM
            </div>
            <span className={`text-sm font-semibold tabular-nums ${usedTone(memPct)}`}>
              {memPct == null ? "—" : `${memPct}%`}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${usedBar(memPct)}`}
              style={{ width: `${memPct ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {report
              ? `${formatMemBytes(report.memory.usedBytes)} used · ${formatMemBytes(report.memory.availableBytes)} avail / ${formatMemBytes(report.memory.totalBytes)}`
              : loading
                ? "Reading…"
                : "Unavailable"}
          </p>
        </div>
      </div>

      {error ? (
        <p className="border-t border-slate-800 px-4 py-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
