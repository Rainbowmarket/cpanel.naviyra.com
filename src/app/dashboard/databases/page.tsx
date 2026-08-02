"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Copy, Database, KeyRound } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { matchesSearch } from "@/lib/utils";

type HostingTarget = { id: string; label: string; documentRoot: string };

type DbConnection = {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  uri: string;
};

type PgDatabase = {
  id: string;
  label: string;
  dbName: string;
  roleName: string;
  domain?: { id: string; name: string };
  connection: DbConnection;
};

export default function DatabasesPage() {
  const { confirm, alert } = useAlert();
  const [targets, setTargets] = useState<HostingTarget[]>([]);
  const [target, setTarget] = useState("");
  const [databases, setDatabases] = useState<PgDatabase[]>([]);
  const [defaults, setDefaults] = useState<{ host: string; port: number } | null>(
    null
  );
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [revealed, setRevealed] = useState<DbConnection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDatabases = useCallback(async () => {
    const res = await fetch("/api/databases");
    const data = await res.json();
    setDatabases(data.databases ?? []);
    if (data.connectionDefaults) setDefaults(data.connectionDefaults);
  }, []);

  useEffect(() => {
    fetch("/api/databases/targets")
      .then((r) => r.json())
      .then((d) => {
        setTargets(d.targets ?? []);
        if (d.targets?.[0]) setTarget(d.targets[0].id);
      });
    loadDatabases();
  }, [loadDatabases]);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      await alert("Copied to clipboard.", { title: "Copied" });
    } catch {
      await alert(text, { title: "Copy manually" });
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, label, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Failed to create database"
        );
        return;
      }
      setLabel("");
      setPassword("");
      setCreateOpen(false);
      if (data.connection) setRevealed(data.connection);
      await loadDatabases();
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!resetId) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/databases", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resetId, password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Failed to reset password"
        );
        return;
      }
      setResetId(null);
      setResetPassword("");
      if (data.connection) setRevealed(data.connection);
      await loadDatabases();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm(
      "Delete this database and its user? This cannot be undone.",
      {
        title: "Delete database",
        danger: true,
        confirmLabel: "Delete",
      }
    );
    if (!ok) return;
    const res = await fetch(`/api/databases?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(
        typeof data.error === "string" ? data.error : "Failed to delete database",
        { title: "Error" }
      );
      return;
    }
    await loadDatabases();
  }

  const filtered = databases.filter((db) =>
    matchesSearch(
      search,
      db.label,
      db.dbName,
      db.roleName,
      db.domain?.name ?? ""
    )
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Databases"
        description="Managed PostgreSQL databases for your apps (localhost)."
        actionLabel="Create Database"
        onAction={() => {
          setError("");
          setCreateOpen(true);
        }}
        actionIcon={<Database className="h-4 w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search databases..."
      />

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
        <p className="font-medium text-white">Connection</p>
        <p className="mt-1 font-mono text-xs text-slate-400">
          Host: {defaults?.host ?? "127.0.0.1"} · Port:{" "}
          {defaults?.port ?? "…"} · Apps on this server connect locally
        </p>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Database"
        description="Creates a PostgreSQL database and login scoped to a domain."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Domain / Subdomain</label>
            <Select
              value={target}
              onChange={setTarget}
              options={targets.map((t) => ({ value: t.id, label: t.label }))}
              placeholder="Choose domain or subdomain..."
            />
          </div>
          <div>
            <label className={modalLabelClass}>Name</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="app_db"
              className={modalInputClass}
              required
              pattern="[A-Za-z][A-Za-z0-9_]*"
              maxLength={32}
            />
          </div>
          <div>
            <label className={modalLabelClass}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={modalInputClass}
              required
              minLength={8}
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            submitLabel={busy ? "Creating…" : "Create Database"}
          />
        </form>
      </Modal>

      <Modal
        open={!!resetId}
        onClose={() => {
          setResetId(null);
          setResetPassword("");
          setError("");
        }}
        title="Reset password"
        description="Set a new password for this database user. Shown once."
      >
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className={modalLabelClass}>New password</label>
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={modalInputClass}
              required
              minLength={8}
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <ModalActions
            onCancel={() => {
              setResetId(null);
              setResetPassword("");
            }}
            submitLabel={busy ? "Saving…" : "Reset password"}
          />
        </form>
      </Modal>

      <Modal
        open={!!revealed}
        onClose={() => setRevealed(null)}
        title="Connection details"
        description="Save the password now — it won’t be shown again."
      >
        {revealed ? (
          <div className="space-y-3 text-sm">
            {(
              [
                ["Host", revealed.host],
                ["Port", String(revealed.port)],
                ["Database", revealed.database],
                ["User", revealed.user],
                ["Password", revealed.password ?? ""],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{k}</p>
                  <p className="truncate font-mono text-slate-200">{v}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(v)}
                  className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                  aria-label={`Copy ${k}`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div>
              <p className="text-xs text-slate-500">URI</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-300">
                {revealed.uri}
              </p>
              <button
                type="button"
                onClick={() => copyText(revealed.uri)}
                className="mt-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Copy URI
              </button>
            </div>
            <div className="flex justify-end border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setRevealed(null)}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/25"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <div className="space-y-2">
        {filtered.map((db) => (
          <div
            key={db.id}
            className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-white">{db.label}</p>
                <p className="text-xs text-slate-500">
                  {db.domain?.name ?? "Domain"}
                </p>
                <p className="mt-2 font-mono text-xs text-slate-400">
                  {db.connection.user}@{db.connection.host}:
                  {db.connection.port}/{db.connection.database}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyText(db.connection.uri)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy URI
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setResetPassword("");
                    setResetId(db.id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Reset password
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(db.id)}
                  className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {databases.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No databases yet. Click Create Database to add one.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No databases match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
