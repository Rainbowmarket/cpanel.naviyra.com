"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, Play, Square, RotateCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { modalInputClass, modalLabelClass } from "@/components/ui/modal";
import {
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

const APP_MODE_OPTIONS = [
  { value: "production", label: "Production" },
  { value: "development", label: "Development" },
];

export function isProxyAppType(t: string) {
  return t === "PYTHON" || t === "GO" || t === "NODE";
}

function defaultStartHint(appType: AppType, startupFile: string): string {
  const file = startupFile.trim() || (
    appType === "NODE" ? "server.js" : appType === "PYTHON" ? "app.py" : "app"
  );
  if (appType === "NODE") return `node ${file}`;
  if (appType === "PYTHON") return `python3 ${file}`;
  return file.startsWith("./") ? file : `./${file}`;
}

type Props = {
  kind: "domain" | "subdomain";
  id: string;
  applicationUrl: string;
  appType: AppType;
  startCommand?: string | null;
  appStartupFile?: string | null;
  appWorkingDir?: string | null;
  upstreamPort?: number | null;
  appStatus?: string | null;
  appEnv?: string | null;
  onUpdated?: () => void;
};

export function AppRuntimeControls({
  kind,
  id,
  applicationUrl,
  appType: initialType,
  startCommand: initialCmd,
  appStartupFile: initialStartup,
  appWorkingDir: initialDir,
  upstreamPort,
  appStatus,
  appEnv: initialEnv,
  onUpdated,
}: Props) {
  const [appType, setAppType] = useState<AppType>(initialType);
  const [appMode, setAppMode] = useState<AppMode>(
    parseAppModeFromEnv(initialEnv)
  );
  const [appStartupFile, setAppStartupFile] = useState(initialStartup ?? "");
  const [startCommand, setStartCommand] = useState(initialCmd ?? "");
  const [appWorkingDir, setAppWorkingDir] = useState(initialDir ?? ".");
  const [appEnv, setAppEnv] = useState(initialEnv ?? "");
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initialCmd?.trim()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(appStatus ?? "STOPPED");
  const [port, setPort] = useState(upstreamPort ?? null);
  const [nodeVersion, setNodeVersion] = useState<string | null>(null);

  useEffect(() => {
    if (appType !== "NODE") return;
    let cancelled = false;
    fetch("/api/apps/runtime-info")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.node) setNodeVersion(String(data.node));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appType]);

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/apps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          id,
          appType,
          appMode: isProxyAppType(appType) ? appMode : undefined,
          appStartupFile: isProxyAppType(appType)
            ? appStartupFile.trim() || null
            : null,
          startCommand: isProxyAppType(appType)
            ? startCommand.trim() || undefined
            : undefined,
          appWorkingDir: isProxyAppType(appType) ? appWorkingDir : undefined,
          appEnv: isProxyAppType(appType) ? appEnv || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setPort(data.site?.upstreamPort ?? null);
      setStatus(data.site?.appStatus ?? "STOPPED");
      if (data.site?.startCommand) setStartCommand(data.site.startCommand);
      onUpdated?.();
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
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, op }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${op} failed`);
      setStatus(data.site?.appStatus ?? (op === "stop" ? "STOPPED" : "RUNNING"));
      onUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${op} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={saveConfig} className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div>
        <label className={modalLabelClass}>App type</label>
        <Select
          value={appType}
          onChange={(v) => setAppType(v as AppType)}
          options={APP_TYPE_OPTIONS}
        />
        <p className="mt-1.5 text-xs text-slate-500">
          {appType === "STATIC" &&
            "Upload a built React SPA (dist/build contents) to the document root."}
          {appType === "PHP" && "Serves PHP via PHP-FPM with index.php front controller."}
          {appType === "NODE" &&
            `System Node.js${nodeVersion ? ` (${nodeVersion})` : ""} — set application root and startup file, then Start.`}
          {appType === "PYTHON" &&
            "Set application root and startup file, or an advanced start command (e.g. uvicorn)."}
          {appType === "GO" &&
            "Upload a compiled binary under application root; set startup file or ./binary command."}
        </p>
      </div>

      {isProxyAppType(appType) ? (
        <>
          <div>
            <label className={modalLabelClass}>Application mode</label>
            <Select
              value={appMode}
              onChange={(v) => setAppMode(v as AppMode)}
              options={APP_MODE_OPTIONS}
            />
            <p className="mt-1 text-xs text-slate-500">
              Sets NODE_ENV and APP_ENV without removing other env vars.
            </p>
          </div>

          <div>
            <label className={modalLabelClass}>Application root</label>
            <input
              className={modalInputClass}
              value={appWorkingDir}
              onChange={(e) => setAppWorkingDir(e.target.value)}
              placeholder="backend"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Physical folder for app files; upload code here (relative to site
              document root). Use <span className="font-mono">.</span> for the
              site root.
            </p>
          </div>

          <div>
            <label className={modalLabelClass}>Application URL</label>
            <input
              className={`${modalInputClass} text-slate-400`}
              value={applicationUrl}
              readOnly
              tabIndex={-1}
            />
          </div>

          <div>
            <label className={modalLabelClass}>Application startup file</label>
            <input
              className={modalInputClass}
              value={appStartupFile}
              onChange={(e) => setAppStartupFile(e.target.value)}
              placeholder={
                appType === "NODE"
                  ? "server.js"
                  : appType === "PYTHON"
                    ? "app.py"
                    : "app"
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              Relative to application root. Default start:{" "}
              <span className="font-mono">
                {defaultStartHint(appType, appStartupFile)}
              </span>
            </p>
          </div>

          <div>
            <button
              type="button"
              className="text-xs text-sky-400 hover:text-sky-300"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide" : "Show"} advanced start command
            </button>
            {showAdvanced ? (
              <div className="mt-2">
                <label className={modalLabelClass}>Start command (optional)</label>
                <input
                  className={modalInputClass}
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                  placeholder={defaultStartHint(appType, appStartupFile)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave empty to use the startup file default. Use{" "}
                  <span className="font-mono">$PORT</span> if needed; PORT and
                  HOST=127.0.0.1 are also set in the environment.
                </p>
              </div>
            ) : null}
          </div>

          <div>
            <label className={modalLabelClass}>Env vars (KEY=VALUE per line)</label>
            <textarea
              className={`${modalInputClass} min-h-[72px] font-mono text-xs`}
              value={appEnv}
              onChange={(e) => setAppEnv(e.target.value)}
              placeholder={"DATABASE_URL=…\n"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span>
              Port:{" "}
              <span className="font-mono text-slate-200">{port ?? "—"}</span>
            </span>
            <span>
              Status:{" "}
              <span
                className={
                  status === "RUNNING"
                    ? "text-emerald-400"
                    : status === "ERROR"
                      ? "text-red-400"
                      : "text-slate-300"
                }
              >
                {status}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => control("start")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" /> Start
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => control("stop")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => control("restart")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 px-3 py-1.5 text-xs text-sky-400 hover:bg-sky-500/10 disabled:opacity-50"
            >
              <RotateCw className="h-3.5 w-3.5" /> Restart
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save app settings"}
      </button>
    </form>
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
