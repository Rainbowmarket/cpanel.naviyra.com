"use client";

import { FormEvent, useState } from "react";
import { AlertCircle, Play, Square, RotateCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { modalInputClass, modalLabelClass } from "@/components/ui/modal";

export type AppType = "STATIC" | "PHP" | "PYTHON" | "GO";

const APP_TYPE_OPTIONS = [
  { value: "STATIC", label: "React / Static (SPA)" },
  { value: "PHP", label: "PHP" },
  { value: "PYTHON", label: "Python" },
  { value: "GO", label: "Go" },
];

export function isProxyAppType(t: string) {
  return t === "PYTHON" || t === "GO";
}

type Props = {
  kind: "domain" | "subdomain";
  id: string;
  appType: AppType;
  startCommand?: string | null;
  appWorkingDir?: string | null;
  upstreamPort?: number | null;
  appStatus?: string | null;
  appEnv?: string | null;
  onUpdated?: () => void;
};

export function AppRuntimeControls({
  kind,
  id,
  appType: initialType,
  startCommand: initialCmd,
  appWorkingDir: initialDir,
  upstreamPort,
  appStatus,
  appEnv: initialEnv,
  onUpdated,
}: Props) {
  const [appType, setAppType] = useState<AppType>(initialType);
  const [startCommand, setStartCommand] = useState(initialCmd ?? "");
  const [appWorkingDir, setAppWorkingDir] = useState(initialDir ?? ".");
  const [appEnv, setAppEnv] = useState(initialEnv ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(appStatus ?? "STOPPED");
  const [port, setPort] = useState(upstreamPort ?? null);

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
          startCommand: isProxyAppType(appType) ? startCommand : undefined,
          appWorkingDir: isProxyAppType(appType) ? appWorkingDir : undefined,
          appEnv: isProxyAppType(appType) ? appEnv || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setPort(data.site?.upstreamPort ?? null);
      setStatus(data.site?.appStatus ?? "STOPPED");
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
          {appType === "PYTHON" &&
            "Example: python3 -m uvicorn main:app --host 127.0.0.1 --port $PORT"}
          {appType === "GO" &&
            "Upload a compiled binary. Example: ./app (must listen on $PORT / 127.0.0.1)."}
        </p>
      </div>

      {isProxyAppType(appType) ? (
        <>
          <div>
            <label className={modalLabelClass}>Start command</label>
            <input
              className={modalInputClass}
              value={startCommand}
              onChange={(e) => setStartCommand(e.target.value)}
              placeholder={
                appType === "PYTHON"
                  ? "python3 -m uvicorn main:app --host 127.0.0.1 --port 12000"
                  : "./app"
              }
              required
            />
          </div>
          <div>
            <label className={modalLabelClass}>Working directory</label>
            <input
              className={modalInputClass}
              value={appWorkingDir}
              onChange={(e) => setAppWorkingDir(e.target.value)}
              placeholder="."
            />
            <p className="mt-1 text-xs text-slate-500">Relative to document root</p>
          </div>
          <div>
            <label className={modalLabelClass}>Env vars (KEY=VALUE per line)</label>
            <textarea
              className={`${modalInputClass} min-h-[72px] font-mono text-xs`}
              value={appEnv}
              onChange={(e) => setAppEnv(e.target.value)}
              placeholder={"APP_ENV=production\n"}
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
