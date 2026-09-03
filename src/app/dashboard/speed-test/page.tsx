"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Gauge,
  Loader2,
  Play,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

type SpeedProbe = {
  direction: "download" | "upload";
  provider: string;
  url: string;
  bytes: number;
  seconds: number;
  mbps: number;
  MBps: number;
  ok: boolean;
  error?: string;
};

type SpeedReport = {
  testedAt: string;
  download: SpeedProbe | null;
  upload: SpeedProbe | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  probes: SpeedProbe[];
};

function formatMbps(mbps: number | null | undefined): string {
  if (mbps == null || !Number.isFinite(mbps)) return "—";
  if (mbps < 10) return `${mbps.toFixed(1)} Mbps`;
  return `${Math.round(mbps)} Mbps`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeedBytes(MBps: number): string {
  if (!Number.isFinite(MBps) || MBps <= 0) return "—";
  if (MBps < 1) return `${Math.round(MBps * 1024)} KB/s`;
  return `${MBps < 10 ? MBps.toFixed(1) : Math.round(MBps)} MB/s`;
}

export default function SpeedTestPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [includeDownload, setIncludeDownload] = useState(true);
  const [includeUpload, setIncludeUpload] = useState(true);
  const [report, setReport] = useState<SpeedReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.role !== "ADMIN") {
          setAllowed(false);
          router.replace("/dashboard");
          return;
        }
        setAllowed(true);
      })
      .catch(() => {
        setAllowed(false);
        router.replace("/dashboard");
      });
  }, [router]);

  const runTest = useCallback(async () => {
    if (!includeDownload && !includeUpload) {
      setError("Select download and/or upload.");
      return;
    }
    setRunning(true);
    setError("");
    setReport(null);
    try {
      const res = await fetch("/api/system/speed-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          download: includeDownload,
          upload: includeUpload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : `HTTP ${res.status}`
        );
      }
      setReport(data as SpeedReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speed test failed");
    } finally {
      setRunning(false);
    }
  }, [includeDownload, includeUpload]);

  if (allowed !== true) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Network Speed Test"
        description="Measures download and upload throughput from this server (not your browser)."
      />

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40"
                checked={includeDownload}
                disabled={running}
                onChange={(e) => setIncludeDownload(e.target.checked)}
              />
              Download
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40"
                checked={includeUpload}
                disabled={running}
                onChange={(e) => setIncludeUpload(e.target.checked)}
              />
              Upload
            </label>
          </div>
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={running || (!includeDownload && !includeUpload)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run speed test
              </>
            )}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Uses public endpoints (Cloudflare / Cachefly / OVH). Takes about 10–30
          seconds. Admin only.
        </p>
        {running ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-amber-300/90">
            <Gauge className="h-4 w-4 animate-pulse" />
            Probing server network — keep this tab open…
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
      </div>

      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-slate-400">
                <ArrowDownToLine className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-medium uppercase tracking-wider">
                  Download
                </span>
              </div>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-white">
                {formatMbps(report.downloadMbps)}
              </p>
              {report.download?.ok ? (
                <p className="mt-1 text-sm text-slate-400">
                  {formatSpeedBytes(report.download.MBps)} ·{" "}
                  {formatBytes(report.download.bytes)} in{" "}
                  {report.download.seconds}s · {report.download.provider}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  {includeDownload
                    ? report.download?.error || "No successful download probe"
                    : "Skipped"}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-slate-400">
                <ArrowUpFromLine className="h-4 w-4 text-sky-400" />
                <span className="text-xs font-medium uppercase tracking-wider">
                  Upload
                </span>
              </div>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-white">
                {formatMbps(report.uploadMbps)}
              </p>
              {report.upload?.ok ? (
                <p className="mt-1 text-sm text-slate-400">
                  {formatSpeedBytes(report.upload.MBps)} ·{" "}
                  {formatBytes(report.upload.bytes)} in {report.upload.seconds}s
                  · {report.upload.provider}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  {includeUpload
                    ? report.upload?.error || "No successful upload probe"
                    : "Skipped"}
                </p>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
            <div className="border-b border-slate-800 px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Probe details ·{" "}
              {new Date(report.testedAt).toLocaleString()}
            </div>
            <ul className="divide-y divide-slate-800/80">
              {report.probes.map((p, i) => (
                <li
                  key={`${p.provider}-${p.direction}-${i}`}
                  className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <span className="font-medium text-slate-200">
                      {p.direction === "download" ? "↓" : "↑"} {p.provider}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500 sm:mt-0 sm:ml-2 sm:inline">
                      {p.url.replace(/^https?:\/\//, "")}
                    </span>
                  </div>
                  <div className="shrink-0 text-left tabular-nums sm:text-right">
                    {p.ok ? (
                      <span className="text-emerald-300">
                        {formatMbps(p.mbps)}{" "}
                        <span className="text-slate-500">
                          ({formatSpeedBytes(p.MBps)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-red-300">{p.error || "Failed"}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
