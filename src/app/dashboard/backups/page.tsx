"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  Globe,
  Download,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { Modal } from "@/components/ui/modal";
import { useAlert } from "@/components/ui/alert-provider";

type BackupSchedule = "EVERY_6H" | "DAILY_02" | "DAILY_03" | "WEEKLY_SUN";

type BackupConfig = {
  id: string;
  enabled: boolean;
  schedule: BackupSchedule;
  retainCount: number;
  includePanelDb: boolean;
  includeSites: boolean;
  includeDns: boolean;
  includeMail: boolean;
  includeDatabases: boolean;
  backupRoot: string;
  timerInstalled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastArchive: string | null;
};

type BackupRun = {
  id: string;
  status: string;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  archivePath: string | null;
  sizeBytes: number | null;
  error: string | null;
  summary: string | null;
};

type DomainOption = { id: string; name: string };

type RestoreSelection = {
  restorePanelDb: boolean;
  restoreSites: boolean;
  restoreDns: boolean;
  restoreMail: boolean;
  restoreDatabases: boolean;
};

const scheduleOptions = [
  { value: "EVERY_6H", label: "Every 6 hours" },
  { value: "DAILY_02", label: "Daily at 02:00 UTC" },
  { value: "DAILY_03", label: "Daily at 03:00 UTC" },
  { value: "WEEKLY_SUN", label: "Weekly Sunday 03:00 UTC" },
];

function scheduleLabel(schedule: BackupSchedule) {
  return (
    scheduleOptions.find((o) => o.value === schedule)?.label ?? schedule
  );
}

function nextScheduledAt(schedule: BackupSchedule, from = new Date()): Date {
  if (schedule === "EVERY_6H") {
    const next = new Date(from);
    next.setUTCMinutes(0, 0, 0);
    const remainder = next.getUTCHours() % 6;
    const onSlot =
      remainder === 0 &&
      from.getUTCMinutes() === 0 &&
      from.getUTCSeconds() === 0 &&
      from.getUTCMilliseconds() === 0;
    if (onSlot) {
      next.setUTCHours(next.getUTCHours() + 6);
    } else {
      next.setUTCHours(next.getUTCHours() - remainder + 6);
    }
    return next;
  }

  const hour = schedule === "DAILY_02" ? 2 : 3;
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      hour,
      0,
      0,
      0
    )
  );
  if (schedule === "WEEKLY_SUN") {
    const daysUntilSunday = (7 - next.getUTCDay()) % 7;
    next.setUTCDate(next.getUTCDate() + daysUntilSunday);
  }
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + (schedule === "WEEKLY_SUN" ? 7 : 1));
  }
  return next;
}

function formatUtcTime(date: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}`;
}

function formatBytes(n: number | null | undefined) {
  if (n == null || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function statusTone(status: string | null | undefined) {
  switch (status) {
    case "COMPLETED":
      return "text-emerald-300";
    case "FAILED":
      return "text-red-400";
    case "RUNNING":
      return "text-amber-300";
    default:
      return "text-slate-400";
  }
}

function parseSummary(summary: string | null): {
  included: string[];
  type?: string;
  domain?: string;
} {
  try {
    const parsed = JSON.parse(summary || "{}") as {
      included?: string[];
      type?: string;
      domain?: string;
    };
    return {
      included: parsed.included ?? [],
      type: parsed.type,
      domain: parsed.domain,
    };
  } catch {
    return { included: [] };
  }
}

function isDomainRun(run: BackupRun): boolean {
  const s = parseSummary(run.summary);
  if (s.type === "domain") return true;
  if (run.source === "domain") return true;
  return Boolean(run.archivePath && /naviyra-domain-/i.test(run.archivePath));
}

function defaultRestoreSelection(
  included: string[],
  domainOnly: boolean
): RestoreSelection {
  const has = (name: string) => included.includes(name);
  const anyKnown =
    has("panel-db") ||
    has("sites") ||
    has("dns") ||
    has("bind-zones") ||
    has("mail") ||
    has("postgres-databases");
  return {
    restorePanelDb: domainOnly
      ? false
      : anyKnown
        ? has("panel-db")
        : true,
    restoreSites: anyKnown ? has("sites") : true,
    restoreDns: anyKnown ? has("dns") || has("bind-zones") : true,
    restoreMail: has("mail"),
    restoreDatabases: has("postgres-databases"),
  };
}

function IncludeChip(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const { checked, onChange, label } = props;
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
        checked
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
          checked
            ? "border-emerald-400 bg-emerald-500 text-white"
            : "border-slate-600"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      {label}
    </label>
  );
}

export default function BackupsPage() {
  const router = useRouter();
  const { confirm } = useAlert();
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [domainId, setDomainId] = useState("");
  const [domainIncludeSites, setDomainIncludeSites] = useState(true);
  const [domainIncludeDns, setDomainIncludeDns] = useState(true);
  const [domainIncludeMail, setDomainIncludeMail] = useState(true);
  const [domainIncludeDatabases, setDomainIncludeDatabases] = useState(true);
  const [domainRunning, setDomainRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [restoreRun, setRestoreRun] = useState<BackupRun | null>(null);
  const [restoreSelection, setRestoreSelection] = useState<RestoreSelection>({
    restorePanelDb: true,
    restoreSites: true,
    restoreDns: true,
    restoreMail: false,
    restoreDatabases: true,
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);

  const restoreMeta = useMemo(
    () => (restoreRun ? parseSummary(restoreRun.summary) : { included: [] }),
    [restoreRun]
  );
  const restoreIsDomain = restoreRun ? isDomainRun(restoreRun) : false;

  async function load() {
    const [backupRes, domainsRes] = await Promise.all([
      fetch("/api/backups"),
      fetch("/api/domains"),
    ]);
    if (backupRes.status === 403) {
      router.replace("/dashboard");
      return;
    }
    if (!backupRes.ok) {
      setError("Failed to load backup settings");
      setLoading(false);
      return;
    }
    const data = await backupRes.json();
    setConfig(data.config);
    setRuns(data.runs ?? []);

    if (domainsRes.ok) {
      const d = await domainsRes.json();
      const list = (d.domains ?? d ?? []) as DomainOption[];
      const normalized = Array.isArray(list)
        ? list.map((x) => ({ id: x.id, name: x.name }))
        : [];
      setDomains(normalized);
      setDomainId((prev) => prev || normalized[0]?.id || "");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [router]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/backups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: config.enabled,
        schedule: config.schedule,
        retainCount: config.retainCount,
        includePanelDb: config.includePanelDb,
        includeSites: config.includeSites,
        includeDns: config.includeDns,
        includeMail: config.includeMail,
        includeDatabases: config.includeDatabases,
        backupRoot: config.backupRoot,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(
        typeof data.error === "string" ? data.error : "Failed to save settings"
      );
      return;
    }
    setConfig(data.config);
    setMessage(
      data.config.enabled
        ? "Saved. systemd timer updated for the selected schedule."
        : "Saved. Automatic backups cancelled."
    );
  }

  async function persistScheduleEnabled(enabled: boolean) {
    if (!config) return false;
    setScheduleBusy(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/backups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    setScheduleBusy(false);
    if (!res.ok) {
      setError(
        typeof data.error === "string"
          ? data.error
          : enabled
            ? "Failed to enable scheduled backups"
            : "Failed to cancel scheduled backups"
      );
      return false;
    }
    setConfig(data.config);
    if (!enabled) setOptionsOpen(false);
    setMessage(
      enabled
        ? `Automatic backups enabled (${scheduleLabel(data.config.schedule)}).`
        : "Automatic backups cancelled. The timer will not run again until you turn it back on."
    );
    return true;
  }

  async function handleCancelSchedule() {
    const ok = await confirm(
      "Cancel the automatic backup schedule?\n\nExisting backup files are kept. You can still run backups manually.",
      { title: "Cancel scheduled backups", danger: true, confirmLabel: "Cancel schedule" }
    );
    if (!ok) return;
    await persistScheduleEnabled(false);
  }

  async function handleRunNow() {
    setRunning(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/backups", { method: "POST" });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Backup failed");
      return;
    }
    if (data.skipped) {
      setMessage(data.reason ?? "Skipped");
    } else {
      setMessage(
        `Domain backups finished: ${data.completed ?? 0} ok` +
          (data.failed ? `, ${data.failed} failed` : "") +
          (data.domains ? ` (${data.domains} domains)` : "")
      );
    }
    load();
  }

  async function handleDomainBackup() {
    if (!domainId) {
      setError("Select a domain to back up");
      return;
    }
    if (
      !domainIncludeSites &&
      !domainIncludeDns &&
      !domainIncludeMail &&
      !domainIncludeDatabases
    ) {
      setError("Select at least one component for the domain backup");
      return;
    }
    setDomainRunning(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/backups/domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId,
        includeSites: domainIncludeSites,
        includeDns: domainIncludeDns,
        includeMail: domainIncludeMail,
        includeDatabases: domainIncludeDatabases,
      }),
    });
    const data = await res.json();
    setDomainRunning(false);
    if (!res.ok) {
      setError(
        typeof data.error === "string" ? data.error : "Domain backup failed"
      );
      return;
    }
    const name =
      domains.find((d) => d.id === domainId)?.name ?? "domain";
    setMessage(
      data.run?.status === "COMPLETED"
        ? `Domain backup completed for ${name}: ${data.run.archivePath ?? "ok"}`
        : `Domain backup ${data.run?.status ?? "finished"} for ${name}`
    );
    load();
  }

  function openRestore(run: BackupRun) {
    const domainOnly = isDomainRun(run);
    setRestoreRun(run);
    setRestoreSelection(
      defaultRestoreSelection(parseSummary(run.summary).included, domainOnly)
    );
    setError("");
    setMessage("");
  }

  async function handleRestoreConfirm() {
    if (!restoreRun) return;
    const selected = restoreIsDomain
      ? restoreSelection.restoreSites ||
        restoreSelection.restoreDns ||
        restoreSelection.restoreMail ||
        restoreSelection.restoreDatabases
      : restoreSelection.restorePanelDb ||
        restoreSelection.restoreSites ||
        restoreSelection.restoreDns ||
        restoreSelection.restoreMail ||
        restoreSelection.restoreDatabases;
    if (!selected) {
      setError("Select at least one component to restore");
      return;
    }

    setRestoringId(restoreRun.id);
    setError("");
    setMessage("");
    const res = await fetch("/api/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: restoreRun.id,
        restorePanelDb: restoreIsDomain
          ? false
          : restoreSelection.restorePanelDb,
        restoreSites: restoreSelection.restoreSites,
        restoreDns: restoreSelection.restoreDns,
        restoreMail: restoreSelection.restoreMail,
        restoreDatabases: restoreSelection.restoreDatabases,
      }),
    });
    const data = await res.json();
    setRestoringId(null);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Restore failed");
      return;
    }
    setRestoreRun(null);
    const parts = (data.restored as string[] | undefined)?.join(", ") ?? "ok";
    setMessage(
      `Restored: ${parts}` +
        (data.safetyDbBackup ? `. Safety DB: ${data.safetyDbBackup}` : "") +
        (data.panelRestartScheduled
          ? " Panel is restarting — refresh in a few seconds."
          : "")
    );
    if (data.panelRestartScheduled) {
      setTimeout(() => load(), 5000);
    }
  }

  async function handleDelete(run: BackupRun) {
    const label = run.archivePath ?? run.id;
    const ok = await confirm(
      `Delete this backup?\n\n${label}\n\nThis removes the archive from disk and the run from history. This cannot be undone.`,
      { title: "Delete backup", danger: true, confirmLabel: "Delete" }
    );
    if (!ok) return;

    setDeletingId(run.id);
    setError("");
    setMessage("");
    const res = await fetch("/api/backups", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id }),
    });
    const data = await res.json();
    setDeletingId(null);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Delete failed");
      return;
    }
    if (restoreRun?.id === run.id) setRestoreRun(null);
    setMessage("Backup deleted.");
    load();
  }

  async function handleDownload(run: BackupRun) {
    if (!run.archivePath) return;
    setDownloadingId(run.id);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `/api/backups/download?runId=${encodeURIComponent(run.id)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string" ? data.error : "Download failed"
        );
        return;
      }
      const blob = await res.blob();
      const disp = res.headers.get("content-disposition") || "";
      const named = /filename="([^"]+)"/.exec(disp)?.[1];
      const fileName =
        named ||
        run.archivePath.split(/[/\\]/).pop() ||
        "backup.tar.gz";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`Downloaded ${fileName}`);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/backups/upload", {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Upload failed");
        return;
      }
      setMessage("Backup uploaded. You can restore it from history.");
      await load();
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }


  if (loading || !config) {
    return <p className="text-slate-400">Loading backup worker...</p>;
  }

  const restoreBusy = restoringId !== null;
  const nextBackupAt = nextScheduledAt(config.schedule);
  const domainOptions = domains.map((d) => ({
    value: d.id,
    label: d.name,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup dashboard"
        description="Backup history"
        actionLabel="Backup options"
        onAction={() => setOptionsOpen(true)}
        actionIcon={<Settings2 className="h-3.5 w-3.5" />}
      />

      {config.lastError ? (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {config.lastError}
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Schedule</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {config.enabled ? scheduleLabel(config.schedule) : "Off"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {config.enabled
              ? `Next ${nextBackupAt.toLocaleString()}`
              : "No automatic runs"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Last status</p>
          <p className={`mt-1 text-sm font-semibold ${statusTone(config.lastStatus)}`}>
            {config.lastStatus || "Never run"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {config.lastRunAt
              ? new Date(config.lastRunAt).toLocaleString()
              : "Trigger a run or wait for the timer"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Success rate</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {runs.length
              ? `${Math.round(
                  (runs.filter((r) => r.status === "COMPLETED").length / runs.length) * 100
                )}%`
              : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {runs.filter((r) => r.status === "COMPLETED").length} of {runs.length} in history
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Retention</p>
          <p className="mt-1 text-sm font-semibold text-white">
            Keep {config.retainCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {runs.filter((r) => r.status === "RUNNING").length} running now
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarClock className="h-4 w-4 text-emerald-400" />
            Automatic schedule
          </div>
          {config.enabled ? (
            <>
              <p className="mt-1 text-sm text-emerald-300">
                {scheduleLabel(config.schedule)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                Next run {nextBackupAt.toLocaleString()}{" "}
                <span className="text-slate-500">
                  ({formatUtcTime(nextBackupAt)} UTC)
                </span>
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">
              Off — automatic backups will not run.
            </p>
          )}
          {config.lastRunAt ? (
            <p className="mt-1 text-[11px] text-slate-500">
              Last run {new Date(config.lastRunAt).toLocaleString()}
              {config.lastStatus ? ` · ${config.lastStatus}` : ""}
            </p>
          ) : null}
        </div>
        {config.enabled ? (
          <button
            type="button"
            onClick={handleCancelSchedule}
            disabled={scheduleBusy}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10 disabled:opacity-50"
          >
            {scheduleBusy ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Ban className="h-3 w-3" />
            )}
            Cancel schedule
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOptionsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            <CalendarClock className="h-3 w-3" />
            Set schedule
          </button>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Archive className="h-4 w-4 text-slate-400" />
            History
          </h2>
          <div className="flex items-center gap-2">
            <input
              ref={uploadRef}
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            <button
              type="button"
              disabled={uploading || restoreBusy}
              onClick={() => uploadRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {uploading ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              Upload
            </button>
            <span className="text-[11px] text-slate-500">
              {config.enabled
                ? scheduleLabel(config.schedule)
                : "Schedule off"}
              {config.lastStatus ? ` · ${config.lastStatus}` : ""}
            </span>
          </div>
        </div>
        {runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800 px-5 py-10 text-center text-sm text-slate-500">
            No backup runs yet. Use Backup options to create one.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-800">
            {runs.map((run, idx) => {
              const meta = parseSummary(run.summary);
              const domainOnly = isDomainRun(run);
              return (
                <div
                  key={run.id}
                  className={`flex flex-wrap items-start justify-between gap-3 bg-slate-950/80 px-3 py-3 sm:px-4 sm:py-3.5 ${
                    idx > 0 ? "border-t border-slate-800" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-sm font-medium ${statusTone(run.status)}`}
                      >
                        {run.status}
                      </span>
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        {domainOnly ? "domain" : run.source}
                      </span>
                      {domainOnly && meta.domain ? (
                        <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                          {meta.domain}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(run.startedAt).toLocaleString()}
                      {run.finishedAt
                        ? ` → ${new Date(run.finishedAt).toLocaleString()}`
                        : ""}
                    </p>
                    {run.archivePath ? (
                      <p
                        className="mt-1 truncate font-mono text-[11px] text-slate-400"
                        title={`${run.archivePath} · ${formatBytes(run.sizeBytes)}`}
                      >
                        {run.archivePath} · {formatBytes(run.sizeBytes)}
                      </p>
                    ) : null}
                    {run.error ? (
                      <p className="mt-1 text-xs text-red-400">{run.error}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {run.status === "COMPLETED" && run.archivePath ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleDownload(run)}
                          disabled={
                            restoreBusy ||
                            deletingId === run.id ||
                            downloadingId === run.id
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                        >
                          {downloadingId === run.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => openRestore(run)}
                          disabled={restoreBusy || deletingId === run.id}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Restore
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleDelete(run)}
                      disabled={deletingId === run.id || restoreBusy}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2.5 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {deletingId === run.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title="Backup options"
        description="Run a domain backup or configure the automatic schedule."
        className="max-w-lg"
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Globe className="h-4 w-4 text-emerald-400" />
                One domain
              </h3>
              <button
                type="button"
                onClick={handleDomainBackup}
                disabled={domainRunning || !domainId}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                {domainRunning ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
                {domainRunning ? "Running…" : "Run backup"}
              </button>
            </div>
            {domainOptions.length === 0 ? (
              <p className="text-sm text-slate-500">No domains available.</p>
            ) : (
              <Select
                value={domainId}
                onChange={setDomainId}
                options={domainOptions}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <IncludeChip
                checked={domainIncludeSites}
                onChange={setDomainIncludeSites}
                label="Website files"
              />
              <IncludeChip
                checked={domainIncludeDns}
                onChange={setDomainIncludeDns}
                label="DNS zone"
              />
              <IncludeChip
                checked={domainIncludeMail}
                onChange={setDomainIncludeMail}
                label="Mail"
              />
              <IncludeChip
                checked={domainIncludeDatabases}
                onChange={setDomainIncludeDatabases}
                label="PostgreSQL"
              />
            </div>
          </section>

          <form
            onSubmit={handleSave}
            className="space-y-3 border-t border-slate-800 pt-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Automatic schedule
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  {config.enabled
                    ? `${scheduleLabel(config.schedule)} · next ${nextBackupAt.toLocaleString()}`
                    : "Off"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                onClick={() =>
                  setConfig({ ...config, enabled: !config.enabled })
                }
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  config.enabled ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
                    config.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <div>
                <label className="mb-1 block text-xs text-slate-400">When</label>
                <Select
                  value={config.schedule}
                  onChange={(v) =>
                    setConfig({ ...config, schedule: v as BackupSchedule })
                  }
                  options={scheduleOptions}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Keep last
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={config.retainCount}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      retainCount: Number(e.target.value) || 7,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Backup folder
              </label>
              <input
                value={config.backupRoot}
                onChange={(e) =>
                  setConfig({ ...config, backupRoot: e.target.value })
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <IncludeChip
                checked={config.includeSites}
                onChange={(v) => setConfig({ ...config, includeSites: v })}
                label="Website files"
              />
              <IncludeChip
                checked={config.includeDns}
                onChange={(v) => setConfig({ ...config, includeDns: v })}
                label="DNS zone"
              />
              <IncludeChip
                checked={config.includeMail}
                onChange={(v) => setConfig({ ...config, includeMail: v })}
                label="Mail"
              />
              <IncludeChip
                checked={config.includeDatabases}
                onChange={(v) => setConfig({ ...config, includeDatabases: v })}
                label="PostgreSQL"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {config.enabled ? (
                <button
                  type="button"
                  onClick={handleCancelSchedule}
                  disabled={scheduleBusy || saving}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  {scheduleBusy ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Ban className="h-3.5 w-3.5" />
                  )}
                  Cancel schedule
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleRunNow}
                disabled={running}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                {running ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Run all now
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save schedule
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal
        open={Boolean(restoreRun)}
        onClose={() => {
          if (!restoreBusy) setRestoreRun(null);
        }}
        title={restoreIsDomain ? "Restore domain backup" : "Custom restore"}
        description={
          restoreIsDomain && restoreMeta.domain
            ? `Choose what to restore for ${restoreMeta.domain}`
            : restoreRun?.archivePath
              ? `Choose what to restore from ${restoreRun.archivePath}`
              : "Choose what to restore from this archive"
        }
        className="max-w-md"
      >
        <div className="space-y-6">
          {restoreMeta.included.length > 0 ? (
            <p className="text-xs text-slate-500">
              Archive contains: {restoreMeta.included.join(", ")}
            </p>
          ) : null}

          <div className="space-y-2">
            {(
              [
                [
                  "restorePanelDb",
                  "Panel SQLite database",
                  "panel-db",
                  !restoreIsDomain,
                ],
                ["restoreSites", "Website files", "sites", true],
                ["restoreDns", "DNS / BIND zones", "dns", true],
                ["restoreMail", "Mail vhosts", "mail", true],
                [
                  "restoreDatabases",
                  "PostgreSQL databases",
                  "postgres-databases",
                  true,
                ],
              ] as const
            )
              .filter(([, , , show]) => show)
              .map(([key, label, tag]) => {
                const inArchive =
                  restoreMeta.included.length === 0 ||
                  restoreMeta.included.includes(tag) ||
                  (tag === "dns" &&
                    restoreMeta.included.includes("bind-zones"));
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      inArchive
                        ? "border-slate-700 text-slate-200"
                        : "border-slate-800 text-slate-500"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={restoreSelection[key]}
                      disabled={!inArchive || restoreBusy}
                      onChange={(e) =>
                        setRestoreSelection({
                          ...restoreSelection,
                          [key]: e.target.checked,
                        })
                      }
                      className="rounded border-slate-600"
                    />
                    <span className="flex-1">{label}</span>
                    {!inArchive ? (
                      <span className="text-[10px] uppercase tracking-wide text-slate-600">
                        not in archive
                      </span>
                    ) : null}
                  </label>
                );
              })}
          </div>

          <p className="text-xs text-amber-200/80">
            {restoreIsDomain
              ? "Only this domain’s selected parts are overwritten. Other domains are left alone."
              : "Restoring overwrites live data for the selected parts. A safety copy of the panel DB is kept first when restoring the database. The panel may restart."}
          </p>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setRestoreRun(null)}
              disabled={restoreBusy}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRestoreConfirm}
              disabled={restoreBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {restoreBusy ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Restore selected
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
