"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

type CatalogItem = { id: string; name: string; what: string };
type RowState = "idle" | "running" | "ok" | "fail" | "skip";
type Row = CatalogItem & {
  state: RowState;
  detail?: string;
  ms?: number;
};

export default function ServiceTestsPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(async (d) => {
        if (d?.user?.role !== "ADMIN") {
          setAllowed(false);
          router.replace("/dashboard");
          return;
        }
        setAllowed(true);
        const res = await fetch("/api/system/service-tests");
        const data = await res.json().catch(() => ({}));
        const tests = Array.isArray(data.tests) ? (data.tests as CatalogItem[]) : [];
        setRows(tests.map((t) => ({ ...t, state: "idle" })));
      })
      .catch(() => {
        setAllowed(false);
        router.replace("/dashboard");
      });
  }, [router]);

  const runOne = useCallback(async (id: string) => {
    setError("");
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, state: "running", detail: undefined, ms: undefined } : r))
    );
    try {
      const res = await fetch("/api/system/service-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      }
      const ok = Boolean(data.ok);
      const skipped = Boolean(data.skipped);
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                state: skipped ? "skip" : ok ? "ok" : "fail",
                detail: typeof data.detail === "string" ? data.detail : "",
                ms: typeof data.ms === "number" ? data.ms : undefined,
              }
            : r
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, state: "fail", detail: msg } : r))
      );
      setError(msg);
    }
  }, []);

  const runAll = useCallback(async () => {
    if (running || rows.length === 0) return;
    setRunning(true);
    setError("");
    const ids = rows.map((r) => r.id);
    setRows((prev) => prev.map((r) => ({ ...r, state: "idle", detail: undefined, ms: undefined })));
    for (const id of ids) {
      await runOne(id);
      await new Promise((r) => setTimeout(r, 180));
    }
    setRunning(false);
  }, [rows, running, runOne]);

  if (allowed !== true) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const passed = rows.filter((r) => r.state === "ok" || r.state === "skip").length;
  const failed = rows.filter((r) => r.state === "fail").length;
  const done = rows.some((r) => r.state !== "idle" && r.state !== "running");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service tests"
        description="Runs each check in order: process up, HTTP, agent, databases, nginx, logs, timers."
        actionLabel={running ? "Testing…" : "Run all tests"}
        onAction={() => void runAll()}
        actionIcon={running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      />

      <p className="text-sm text-slate-400">
        Click <span className="text-slate-200">Test</span> on one service, or{" "}
        <span className="text-slate-200">Run all tests</span> to go through the list in order.
      </p>

      {done ? (
        <p className="text-sm text-slate-400">
          {failed === 0 ? (
            <span className="text-emerald-400">{passed} checks passed</span>
          ) : (
            <>
              <span className="text-emerald-400">{passed} passed</span>
              <span className="text-slate-600"> · </span>
              <span className="text-red-400">{failed} failed</span>
            </>
          )}
        </p>
      ) : null}

      <ol className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
        {rows.map((row, index) => (
          <li key={row.id} className="flex gap-3 px-4 py-3 sm:px-5">
            <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-slate-600">
              {index + 1}
            </span>
            <span className="pt-0.5">
              {row.state === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
              ) : row.state === "ok" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : row.state === "fail" ? (
                <XCircle className="h-4 w-4 text-red-400" />
              ) : row.state === "skip" ? (
                <CheckCircle2 className="h-4 w-4 text-slate-500" />
              ) : (
                <Circle className="h-4 w-4 text-slate-700" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">{row.name}</p>
              <p className="text-xs text-slate-500">{row.what}</p>
              {row.detail ? (
                <p
                  className={cn(
                    "mt-1 font-mono text-[11px] leading-relaxed",
                    row.state === "fail" ? "text-red-300" : "text-slate-400"
                  )}
                >
                  {row.detail}
                  {row.ms != null ? ` · ${row.ms} ms` : ""}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={running || row.state === "running"}
              onClick={() => void runOne(row.id)}
              className="shrink-0 self-center rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-40"
            >
              {row.state === "running" ? "Testing…" : "Test"}
            </button>
          </li>
        ))}
      </ol>

      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">Access log vs error log</h3>
        <div className="grid gap-3 text-sm text-slate-400 sm:grid-cols-2">
          <div>
            <p className="font-medium text-slate-200">access.log</p>
            <p className="mt-1 text-xs leading-relaxed">
              Every HTTP request nginx handled: IP, time, URL, status code (200, 404, …).
              Path: <span className="font-mono text-slate-300">/var/log/nginx/access.log</span>
            </p>
          </div>
          <div>
            <p className="font-medium text-slate-200">error.log</p>
            <p className="mt-1 text-xs leading-relaxed">
              nginx itself failing: bad config, missing files, upstream refused. Not the same as a
              website 404. Path:{" "}
              <span className="font-mono text-slate-300">/var/log/nginx/error.log</span>
            </p>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          Security Manager does not read those two files. It uses{" "}
          <span className="font-mono text-slate-400">/var/log/nginx/naviyra-visitors.log</span>{" "}
          (same request style as access.log, plus the site hostname <span className="font-mono">$host</span>
          ). Rotated copies end in <span className="font-mono">.1</span> or <span className="font-mono">.gz</span>.
        </p>
      </section>
    </div>
  );
}
