"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Globe,
  Play,
  Plus,
  RotateCw,
  Settings2,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { modalInputClass, modalLabelClass } from "@/components/ui/modal";
import {
  fastapiStartCommand,
  normalizeAppWorkingDir,
  parseAppModeFromEnv,
  type AppMode,
} from "@/lib/apps/runtime-helpers";

export type AppType = "STATIC" | "PHP" | "PYTHON" | "GO" | "NODE";

const APP_TYPE_OPTIONS = [
  { value: "STATIC", label: "React / Static (SPA)" },
  { value: "PHP", label: "PHP" },
  { value: "NODE", label: "Node.js" },
  { value: "PYTHON", label: "Python" },
  { value: "GO", label: "Go" },
];

const RUNTIME_CHIPS: { value: AppType; label: string }[] = [
  { value: "PYTHON", label: "Python" },
  { value: "NODE", label: "Node.js" },
  { value: "PHP", label: "PHP" },
  { value: "GO", label: "Go" },
  { value: "STATIC", label: "Static" },
];

const APP_MODE_OPTIONS = [
  { value: "production", label: "Production" },
  { value: "development", label: "Development" },
];

type EnvRow = { id: string; key: string; value: string };

function newRowId() {
  return `env-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseEnvRows(text: string | null | undefined): EnvRow[] {
  const rows: EnvRow[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^export\s+/i.test(trimmed)) trimmed = trimmed.replace(/^export\s+/i, "");
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    rows.push({
      id: newRowId(),
      key: trimmed.slice(0, eq).trim(),
      value,
    });
  }
  return rows;
}

export function serializeEnvRows(rows: EnvRow[]): string {
  return rows
    .filter((row) => row.key.trim())
    .map((row) => `${row.key.trim()}=${row.value}`)
    .join("\n");
}

function isSecretKey(key: string) {
  return /(secret|password|passwd|token|api[_-]?key|auth)/i.test(key);
}

export function isProxyAppType(t: string) {
  return t === "PYTHON" || t === "GO" || t === "NODE";
}

function defaultStartHint(appType: AppType, startupFile: string): string {
  const file =
    startupFile.trim() ||
    (appType === "NODE" ? "server.js" : appType === "PYTHON" ? "app.py" : "app");
  if (appType === "NODE") return `node ${file}`;
  if (appType === "PYTHON") return `python3 -u ${file}`;
  return file.startsWith("./") ? file : `./${file}`;
}

function appDisplayName(hostname: string) {
  const host = hostname.replace(/^https?:\/\//, "").split("/")[0] || hostname;
  return host.split(".")[0] || host;
}

function runtimeLabel(appType: AppType, versions: {
  node: string | null;
  python: string | null;
  go: string | null;
}) {
  if (appType === "PYTHON") {
    return versions.python ? `Python ${versions.python.replace(/^Python\s+/i, "")}` : "Python";
  }
  if (appType === "NODE") {
    return versions.node ? `Node.js ${versions.node.replace(/^v/, "")}` : "Node.js";
  }
  if (appType === "GO") {
    return versions.go ? `Go ${versions.go.replace(/^go/i, "")}` : "Go";
  }
  if (appType === "PHP") return "PHP";
  return "Static";
}

function statusTone(status: string) {
  if (status === "RUNNING") {
    return {
      badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
      dot: "bg-emerald-400",
      label: "Running",
    };
  }
  if (status === "ERROR") {
    return {
      badge: "border-red-500/30 bg-red-500/15 text-red-300",
      dot: "bg-red-400",
      label: "Error",
    };
  }
  return {
    badge: "border-slate-600 bg-slate-800/80 text-slate-300",
    dot: "bg-slate-500",
    label: status === "STOPPED" ? "Stopped" : status,
  };
}

const cardClass =
  "rounded-2xl border border-slate-800/80 bg-slate-950/70 p-5 shadow-sm shadow-black/20";

type Props = {
  kind: "domain" | "subdomain";
  id: string;
  applicationUrl: string;
  hostname?: string;
  appType: AppType;
  startCommand?: string | null;
  appStartupFile?: string | null;
  appWorkingDir?: string | null;
  upstreamPort?: number | null;
  appStatus?: string | null;
  appEnv?: string | null;
  documentRoot?: string | null;
  onUpdated?: () => void;
};

export function AppRuntimeControls({
  kind,
  id,
  applicationUrl,
  hostname,
  appType: initialType,
  startCommand: initialCmd,
  appStartupFile: initialStartup,
  appWorkingDir: initialDir,
  upstreamPort,
  appStatus,
  appEnv: initialEnv,
  documentRoot,
  onUpdated,
}: Props) {
  const host =
    hostname ||
    applicationUrl.replace(/^https?:\/\//, "").split("/")[0] ||
    "app";
  const [appType, setAppType] = useState<AppType>(initialType);
  const [appMode, setAppMode] = useState<AppMode>(
    parseAppModeFromEnv(initialEnv)
  );
  const [appStartupFile, setAppStartupFile] = useState(initialStartup ?? "");
  const [startCommand, setStartCommand] = useState(initialCmd ?? "");
  const [appWorkingDir, setAppWorkingDir] = useState(() => {
    try {
      return normalizeAppWorkingDir(initialDir ?? ".", documentRoot);
    } catch {
      return ".";
    }
  });
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [envPath, setEnvPath] = useState<string | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [showAllEnv, setShowAllEnv] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(appStatus ?? "STOPPED");
  const [port, setPort] = useState(upstreamPort ?? null);
  const [nodeVersion, setNodeVersion] = useState<string | null>(null);
  const [pythonVersion, setPythonVersion] = useState<string | null>(null);
  const [goVersion, setGoVersion] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [startupOk, setStartupOk] = useState(Boolean(initialStartup?.trim()));

  const proxy = isProxyAppType(appType);
  const tone = statusTone(status);
  const visibleEnv = showAllEnv ? envRows : envRows.slice(0, 5);

  const versions = useMemo(
    () => ({ node: nodeVersion, python: pythonVersion, go: goVersion }),
    [nodeVersion, pythonVersion, goVersion]
  );

  useEffect(() => {
    let cancelled = false;
    setEnvLoading(true);
    fetch(
      `/api/apps/env?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data.path === "string") setEnvPath(data.path);
        const fromFile = Array.isArray(data.vars)
          ? (data.vars as Array<{ key?: string; value?: string }>)
              .filter((item) => typeof item.key === "string" && item.key.trim())
              .map((item) => ({
                id: newRowId(),
                key: String(item.key),
                value: String(item.value ?? ""),
              }))
          : [];
        setEnvRows(fromFile.length ? fromFile : parseEnvRows(initialEnv));
      })
      .catch(() => {
        if (!cancelled) setEnvRows(parseEnvRows(initialEnv));
      })
      .finally(() => {
        if (!cancelled) setEnvLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id, initialEnv]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/apps/runtime-info")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.node) setNodeVersion(String(data.node));
        if (data.python) setPythonVersion(String(data.python));
        if (data.go) setGoVersion(String(data.go));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadLogs() {
    try {
      const res = await fetch(
        `/api/apps?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&logs=1`
      );
      const data = await res.json();
      if (res.ok) setLogs(String(data.logs ?? ""));
    } catch {
      /* ignore */
    }
  }

  async function persistConfig(nextRows?: EnvRow[]) {
    const res = await fetch("/api/apps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        id,
        appType,
        appMode: proxy ? appMode : undefined,
        appStartupFile: proxy ? appStartupFile.trim() || null : null,
        startCommand: proxy ? startCommand.trim() || undefined : undefined,
        appWorkingDir: proxy ? appWorkingDir : undefined,
        appEnv: proxy ? serializeEnvRows(nextRows ?? envRows) || null : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Save failed");
    setPort(data.site?.upstreamPort ?? null);
    setStatus(data.site?.appStatus ?? "STOPPED");
    if (data.site?.startCommand) setStartCommand(data.site.startCommand);
    onUpdated?.();
    return data;
  }

  async function saveQuiet() {
    setBusy(true);
    setError("");
    try {
      await persistConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function control(op: "start" | "stop" | "restart") {
    setBusy(true);
    setError("");
    try {
      if (op === "start" || op === "restart") {
        await persistConfig();
      }
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, op }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${op} failed`);
      setStatus(data.site?.appStatus ?? (op === "stop" ? "STOPPED" : "RUNNING"));
      if (data.site?.upstreamPort) setPort(data.site.upstreamPort);
      onUpdated?.();
      await loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${op} failed`);
      await loadLogs();
    } finally {
      setBusy(false);
    }
  }

  const uploadHref = `/file-manager?target=${kind === "subdomain" ? "s" : "d"}:${id}`;
  const startupPlaceholder =
    appType === "NODE" ? "server.js" : appType === "PYTHON" ? "app/main.py" : "app";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-white">
          {appDisplayName(host)}
        </h2>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone.badge}`}
        >
          {tone.label}
        </span>
      </div>

      <div className={`${cardClass} flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="grid min-w-0 flex-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Domain
            </p>
            <a
              href={applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-2 truncate text-sm font-medium text-sky-400 hover:text-sky-300"
            >
              <Globe className="h-4 w-4 shrink-0" />
              <span className="truncate">{host}</span>
            </a>
            {documentRoot ? (
              <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                {documentRoot}
              </p>
            ) : null}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Runtime
            </p>
            <p className="text-sm font-medium text-white">
              {runtimeLabel(appType, versions)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {appType === "STATIC" ? "nginx files" : "64-bit"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Status
            </p>
            <p className="inline-flex items-center gap-2 text-sm font-medium text-white">
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
              {tone.label}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {proxy
                ? port
                  ? `Port ${port}`
                  : "No port yet"
                : "Served by nginx"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Open
            </p>
            <p className="text-sm font-medium text-white">HTTPS</p>
            <p className="mt-1 text-[11px] text-slate-500">Public URL</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a
            href={applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
          >
            <ExternalLink className="h-4 w-4" />
            Open App
          </a>
          <a
            href={uploadHref}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            <Upload className="h-4 w-4" />
            Upload Code
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {RUNTIME_CHIPS.map((chip) => {
          const active = appType === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              disabled={busy}
              onClick={() => setAppType(chip.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                  : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className={`${cardClass} space-y-6`}>
          {proxy ? (
            <>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-200">
                  Startup File
                </label>
                <div className="relative">
                  <input
                    className={`${modalInputClass} pr-10`}
                    value={appStartupFile}
                    onChange={(e) => {
                      setAppStartupFile(e.target.value);
                      setStartupOk(Boolean(e.target.value.trim()));
                    }}
                    onBlur={() => void saveQuiet()}
                    placeholder={startupPlaceholder}
                  />
                  {startupOk ? (
                    <Check className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" />
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Relative to application root directory.
                </p>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium text-slate-200">
                      Environment Variables
                    </h3>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {envLoading
                        ? "Loading from site directory…"
                        : envPath
                          ? `From ${envPath}`
                          : "From the selected site directory"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEnvRows((rows) => [
                        ...rows,
                        { id: newRowId(), key: "", value: "" },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/10"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Variable
                  </button>
                </div>
                <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800">
                  {envLoading ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-500">
                      Reading .env from the domain directory…
                    </p>
                  ) : visibleEnv.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-500">
                      No variables yet. Add keys your app reads on start.
                    </p>
                  ) : (
                    visibleEnv.map((row) => {
                      const secret = isSecretKey(row.key) && !revealed[row.id];
                      return (
                        <div
                          key={row.id}
                          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2 px-3 py-2.5"
                        >
                          <input
                            className="min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-slate-700"
                            value={row.key}
                            placeholder="KEY"
                            onChange={(e) =>
                              setEnvRows((rows) =>
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, key: e.target.value }
                                    : item
                                )
                              )
                            }
                            onBlur={() => void saveQuiet()}
                          />
                          <input
                            className="min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 font-mono text-xs text-slate-400 outline-none focus:border-slate-700"
                            value={row.value}
                            placeholder="value"
                            type={secret ? "password" : "text"}
                            onChange={(e) =>
                              setEnvRows((rows) =>
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, value: e.target.value }
                                    : item
                                )
                              )
                            }
                            onFocus={() =>
                              setRevealed((prev) => ({ ...prev, [row.id]: true }))
                            }
                            onBlur={() => void saveQuiet()}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = envRows.filter((item) => item.id !== row.id);
                              setEnvRows(next);
                              void persistConfig(next).catch((err) =>
                                setError(
                                  err instanceof Error ? err.message : "Save failed"
                                )
                              );
                            }}
                            className="rounded-md p-1.5 text-red-400 hover:bg-red-500/10"
                            aria-label="Remove variable"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                {envRows.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllEnv((v) => !v)}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
                  >
                    {showAllEnv
                      ? "Show fewer"
                      : `Show all variables (${envRows.length})`}
                    <ChevronDown
                      className={`h-3.5 w-3.5 ${showAllEnv ? "rotate-180" : ""}`}
                    />
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-slate-400">
              {appType === "PHP"
                ? "PHP is served by nginx and PHP-FPM. Upload your files, then open the site — no start command is needed."
                : "Static sites are served as files. Upload a built SPA or HTML, then open the site."}
            </p>
          )}
        </div>

        <div className="space-y-5">
          <div className={cardClass}>
            <h3 className="mb-4 text-sm font-medium text-slate-200">
              Quick Actions
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || !proxy}
                onClick={() => void control("start")}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/35 px-3 py-2.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                <Play className="h-4 w-4" />
                Start
              </button>
              <button
                type="button"
                disabled={busy || !proxy}
                onClick={() => void control("restart")}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-500/35 px-3 py-2.5 text-sm font-medium text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
              >
                <RotateCw className="h-4 w-4" />
                Restart
              </button>
              <button
                type="button"
                disabled={busy || !proxy}
                onClick={() => void control("stop")}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/35 px-3 py-2.5 text-sm font-medium text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
              <button
                type="button"
                disabled={busy || !proxy}
                onClick={() => {
                  setShowLogs((v) => !v);
                  void loadLogs();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                <FileText className="h-4 w-4" />
                Logs
              </button>
            </div>
          </div>

          {showLogs ? (
            <pre className="max-h-56 overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-400">
              {logs.trim() || "No logs yet. Start the app to capture output."}
            </pre>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="flex items-start gap-2 whitespace-pre-wrap text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className={`${cardClass} flex w-full items-center justify-between text-left`}
      >
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300">
            <Settings2 className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-medium text-white">
              Advanced Settings
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Custom commands, environment, and more.
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 text-slate-500 transition ${showAdvanced ? "rotate-180" : ""}`}
        />
      </button>

      {showAdvanced ? (
        <div className={`${cardClass} space-y-4`}>
          {proxy ? (
            <>
              <div>
                <label className={modalLabelClass}>Application mode</label>
                <Select
                  value={appMode}
                  onChange={(v) => setAppMode(v as AppMode)}
                  options={APP_MODE_OPTIONS}
                />
              </div>
              <div>
                <label className={modalLabelClass}>Application root</label>
                <input
                  className={modalInputClass}
                  value={appWorkingDir}
                  onChange={(e) => setAppWorkingDir(e.target.value)}
                  placeholder="."
                />
                <p className="mt-1 text-xs text-slate-500">
                  Folder under the site path. Use <span className="font-mono">.</span>{" "}
                  for the site root.
                </p>
              </div>
              <div>
                <label className={modalLabelClass}>Start command (optional)</label>
                <input
                  className={modalInputClass}
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                  placeholder={defaultStartHint(appType, appStartupFile)}
                />
                {appType === "PYTHON" ? (
                  <button
                    type="button"
                    className="mt-2 text-xs text-sky-400 hover:text-sky-300"
                    onClick={() =>
                      setStartCommand(
                        fastapiStartCommand(appStartupFile || "main.py")
                      )
                    }
                  >
                    Use FastAPI / uvicorn
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-slate-500">
                Port{" "}
                <span className="font-mono text-slate-300">{port ?? "auto"}</span>
                {" · "}
                Default start{" "}
                <span className="font-mono text-slate-300">
                  {defaultStartHint(appType, appStartupFile)}
                </span>
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400">
              No process settings for this runtime. Change to Node.js, Python, or
              Go to run a backend.
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveQuiet()}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppTypeSelectField({
  value,
  onChange,
}: {
  value: AppType;
  onChange: (v: AppType) => void;
}) {
  return (
    <div>
      <label className={modalLabelClass}>App type</label>
      <Select
        value={value}
        onChange={(v) => onChange(v as AppType)}
        options={APP_TYPE_OPTIONS}
      />
    </div>
  );
}
