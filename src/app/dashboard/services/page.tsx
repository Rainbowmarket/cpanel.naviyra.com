"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PackagePlus, Play, Power, RefreshCw, Square } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { cn } from "@/lib/utils";

type HostService = {
  id: string;
  name: string;
  group: string;
  detail: string;
  kind: "service" | "timer";
  unit: string;
  installed: boolean;
  active: boolean;
  enabled: boolean;
  state: string;
  allowStop: boolean;
  dryRun: boolean;
  installable?: boolean;
};

const INSTALLABLE_IDS = new Set([
  "postfix",
  "dovecot",
  "ftp",
  "dns",
  "nginx",
  "php-fpm",
  "postgresql",
  "backup-timer",
]);

type Op = "start" | "stop" | "restart" | "install";

export default function HostServicesPage() {
  const { alert, confirm } = useAlert();
  const [rows, setRows] = useState<HostService[]>([]);
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/system/services");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Failed to load services");
    }
    setRows(Array.isArray(data.services) ? data.services : []);
    setDryRun(Boolean(data.dryRun));
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, HostService[]>();
    for (const row of rows) {
      const list = map.get(row.group) ?? [];
      list.push(row);
      map.set(row.group, list);
    }
    return [...map.entries()];
  }, [rows]);

  async function runOp(row: HostService, op: Op) {
    if (op === "install") {
      const ok = await confirm(
        row.id === "postfix" || row.id === "dovecot"
          ? "This installs Postfix and Dovecot with apt (a few minutes). Continue?"
          : row.id === "backup-timer"
            ? "This installs the naviyra-backup systemd timer and enables scheduled backups. Continue?"
            : `This will apt-install ${row.name} on this server. It can take several minutes. Continue?`,
        { title: `Install ${row.name}?`, confirmLabel: "Install", tone: "warning" }
      );
      if (!ok) return;
    }
    if (op === "stop" && !row.allowStop) {
      await alert(
        `${row.name} cannot be stopped from the panel. Use Restart to recycle it without locking yourself out.`
      );
      return;
    }
    if (op === "stop") {
      const ok = await confirm(
        `${row.unit} will be stopped. Sites or mail that depend on it will go offline until you start it again.`,
        { title: `Stop ${row.name}?`, confirmLabel: "Stop", tone: "warning", danger: true }
      );
      if (!ok) return;
    }
    setError("");
    setBusy(`${row.id}:${op}`);
    try {
      const res = await fetch("/api/system/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, op }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed";
      setError(msg);
      await alert(msg);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description="Start, stop, restart, or install host packages (mail, FTP, DNS, nginx, PHP, PostgreSQL). Only allowlisted units and scripts run on the server."
        actionLabel={loading ? "Loading…" : "Refresh"}
        onAction={() => {
          setLoading(true);
          load()
            .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
            .finally(() => setLoading(false));
        }}
        actionIcon={
          loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )
        }
      />

      <p className="text-sm text-slate-400">
        Start and stop nginx, PHP, PostgreSQL, mail, FTP, DNS, visitor ingest, backups, and the
        agent. The panel process can be restarted but not stopped, so you are not locked out.
      </p>

      {dryRun ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Agent is in dry-run mode. Buttons will not change systemd on this machine.
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading services…
        </div>
      ) : (
        grouped.map(([group, items]) => (
          <section
            key={group}
            className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
          >
            <h2 className="border-b border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {group}
            </h2>
            <ul className="divide-y divide-slate-800">
              {items.map((row) => {
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "h-2.5 w-2.5 shrink-0 rounded-full",
                            !row.installed
                              ? "bg-slate-600"
                              : row.active
                                ? "bg-emerald-400"
                                : "bg-red-500"
                          )}
                        />
                        <p className="text-sm font-medium text-white">{row.name}</p>
                        <span className="font-mono text-[11px] text-slate-500">{row.unit}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{row.detail}</p>
                      <p className="mt-0.5 text-[11px] text-slate-600">
                        {row.installed
                          ? `${row.state}${row.enabled ? " · enabled" : " · not enabled"}`
                          : "Not installed on this host"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {!row.installed && (row.installable || INSTALLABLE_IDS.has(row.id)) ? (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void runOp(row, "install")}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-700/60 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-slate-800 disabled:opacity-40"
                        >
                          {busy === `${row.id}:install` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <PackagePlus className="h-3 w-3" />
                          )}
                          Install
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={Boolean(busy) || !row.installed || row.active}
                        onClick={() => void runOp(row, "start")}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-slate-800 disabled:opacity-40"
                      >
                        {busy === `${row.id}:start` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Start
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy) || !row.installed || !row.allowStop || !row.active}
                        onClick={() => void runOp(row, "stop")}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-medium text-amber-300 hover:bg-slate-800 disabled:opacity-40"
                      >
                        {busy === `${row.id}:stop` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3" />
                        )}
                        Stop
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy) || !row.installed}
                        onClick={() => void runOp(row, "restart")}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-slate-800 disabled:opacity-40"
                      >
                        {busy === `${row.id}:restart` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Power className="h-3 w-3" />
                        )}
                        Restart
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
