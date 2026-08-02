"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Copy, Database, KeyRound, Table2 } from "lucide-react";
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

type SchemaColumn = {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  defaultValue: string | null;
  ordinal: number;
  isPrimaryKey: boolean;
};

type SchemaTable = {
  schema: string;
  name: string;
  kind: string;
  approxRows: number | null;
  columns: SchemaColumn[];
};

type TablePreview = {
  columns: string[];
  rows: Record<string, unknown>[];
  limit: number;
};

type CreateColumnDraft = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
};

const COLUMN_TYPE_OPTIONS = [
  { value: "serial", label: "serial (auto int)" },
  { value: "bigserial", label: "bigserial" },
  { value: "integer", label: "integer" },
  { value: "bigint", label: "bigint" },
  { value: "text", label: "text" },
  { value: "varchar(255)", label: "varchar(255)" },
  { value: "boolean", label: "boolean" },
  { value: "numeric", label: "numeric" },
  { value: "uuid", label: "uuid" },
  { value: "timestamptz", label: "timestamptz" },
  { value: "date", label: "date" },
  { value: "jsonb", label: "jsonb" },
];

function emptyCreateColumn(primaryKey = false): CreateColumnDraft {
  return {
    name: primaryKey ? "id" : "",
    type: primaryKey ? "serial" : "text",
    nullable: !primaryKey,
    primaryKey,
    defaultValue: "",
  };
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

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
  const [browseDb, setBrowseDb] = useState<PgDatabase | null>(null);
  const [schemaTables, setSchemaTables] = useState<SchemaTable[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState("");
  const [selectedTableKey, setSelectedTableKey] = useState("");
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [createTableName, setCreateTableName] = useState("");
  const [createColumns, setCreateColumns] = useState<CreateColumnDraft[]>([
    emptyCreateColumn(true),
    emptyCreateColumn(false),
  ]);
  const [createError, setCreateError] = useState("");
  const [creatingTable, setCreatingTable] = useState(false);
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

  async function reloadSchema(db: PgDatabase, preferTable?: string) {
    setSchemaError("");
    setSchemaLoading(true);
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(db.id)}/schema`);
      const data = await res.json();
      if (!res.ok) {
        setSchemaError(
          typeof data.error === "string"
            ? data.error
            : "Failed to load schema"
        );
        return;
      }
      const tables = (data.tables ?? []) as SchemaTable[];
      setSchemaTables(tables);
      const preferred =
        (preferTable
          ? tables.find(
              (t) =>
                t.name === preferTable ||
                `${t.schema}.${t.name}` === preferTable
            )
          : null) ?? tables[0];
      if (preferred) {
        const key = `${preferred.schema}.${preferred.name}`;
        setSelectedTableKey(key);
        await loadTablePreview(db.id, preferred.schema, preferred.name);
      } else {
        setSelectedTableKey("");
        setPreview(null);
      }
    } finally {
      setSchemaLoading(false);
    }
  }

  async function openSchemaBrowser(db: PgDatabase) {
    setBrowseDb(db);
    setSchemaTables([]);
    setSelectedTableKey("");
    setPreview(null);
    setPreviewError("");
    setSchemaError("");
    setCreateTableOpen(false);
    setCreateError("");
    await reloadSchema(db);
  }

  async function loadTablePreview(
    dbId: string,
    schema: string,
    table: string
  ) {
    setPreviewLoading(true);
    setPreviewError("");
    setPreview(null);
    try {
      const qs = new URLSearchParams({
        schema,
        table,
        limit: "50",
      });
      const res = await fetch(
        `/api/databases/${encodeURIComponent(dbId)}/preview?${qs}`
      );
      const data = await res.json();
      if (!res.ok) {
        setPreviewError(
          typeof data.error === "string"
            ? data.error
            : "Failed to load table rows"
        );
        return;
      }
      setPreview({
        columns: data.columns ?? [],
        rows: data.rows ?? [],
        limit: data.limit ?? 50,
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function selectSchemaTable(table: SchemaTable) {
    if (!browseDb) return;
    const key = `${table.schema}.${table.name}`;
    setSelectedTableKey(key);
    setCreateTableOpen(false);
    await loadTablePreview(browseDb.id, table.schema, table.name);
  }

  function openCreateTableForm() {
    setCreateTableOpen(true);
    setCreateTableName("");
    setCreateColumns([emptyCreateColumn(true), emptyCreateColumn(false)]);
    setCreateError("");
  }

  async function handleCreateTable(e: FormEvent) {
    e.preventDefault();
    if (!browseDb) return;
    setCreateError("");
    setCreatingTable(true);
    try {
      const res = await fetch(
        `/api/databases/${encodeURIComponent(browseDb.id)}/tables`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema: "public",
            table: createTableName.trim(),
            columns: createColumns.map((col) => ({
              name: col.name.trim(),
              type: col.type,
              nullable: col.primaryKey ? false : col.nullable,
              primaryKey: col.primaryKey,
              defaultValue: col.defaultValue.trim() || null,
            })),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setCreateError(
          typeof data.error === "string"
            ? data.error
            : "Failed to create table on server"
        );
        return;
      }
      setCreateTableOpen(false);
      await reloadSchema(browseDb, String(data.table || createTableName.trim()));
    } finally {
      setCreatingTable(false);
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

      <Modal
        open={!!browseDb}
        onClose={() => {
          setBrowseDb(null);
          setSchemaTables([]);
          setSelectedTableKey("");
          setPreview(null);
          setSchemaError("");
          setPreviewError("");
          setCreateTableOpen(false);
          setCreateError("");
        }}
        title={browseDb ? `Browse · ${browseDb.label}` : "Browse database"}
        description={
          browseDb
            ? `${browseDb.dbName} · schema, preview, and create tables`
            : "Database schema viewer"
        }
        className="max-w-5xl"
      >
        {schemaLoading ? (
          <p className="text-sm text-slate-400">Loading schema…</p>
        ) : schemaError ? (
          <p className="text-sm text-red-400">{schemaError}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                {schemaTables.length} table
                {schemaTables.length === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={openCreateTableForm}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
              >
                <Table2 className="h-3.5 w-3.5" />
                Create table
              </button>
            </div>

            {createTableOpen ? (
              <form
                onSubmit={handleCreateTable}
                className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3"
              >
                <div>
                  <label className={modalLabelClass}>Table name</label>
                  <input
                    value={createTableName}
                    onChange={(e) => setCreateTableName(e.target.value)}
                    placeholder="products"
                    className={modalInputClass}
                    required
                    pattern="[A-Za-z_][A-Za-z0-9_]*"
                    maxLength={63}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-400">Columns</p>
                  {createColumns.map((col, idx) => (
                    <div
                      key={idx}
                      className="grid gap-2 rounded-md border border-slate-800 p-2 sm:grid-cols-[1fr_8rem_auto_auto_1fr_auto]"
                    >
                      <input
                        value={col.name}
                        onChange={(e) => {
                          const next = [...createColumns];
                          next[idx] = { ...col, name: e.target.value };
                          setCreateColumns(next);
                        }}
                        placeholder="column"
                        className={modalInputClass}
                        required
                        pattern="[A-Za-z_][A-Za-z0-9_]*"
                      />
                      <select
                        value={col.type}
                        onChange={(e) => {
                          const next = [...createColumns];
                          next[idx] = { ...col, type: e.target.value };
                          setCreateColumns(next);
                        }}
                        className={modalInputClass}
                      >
                        {COLUMN_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          checked={col.primaryKey}
                          onChange={(e) => {
                            const next = createColumns.map((c, i) =>
                              i === idx
                                ? {
                                    ...c,
                                    primaryKey: e.target.checked,
                                    nullable: e.target.checked
                                      ? false
                                      : c.nullable,
                                  }
                                : c
                            );
                            setCreateColumns(next);
                          }}
                        />
                        PK
                      </label>
                      <label className="flex items-center gap-1 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          disabled={col.primaryKey}
                          onChange={(e) => {
                            const next = [...createColumns];
                            next[idx] = {
                              ...col,
                              nullable: e.target.checked,
                            };
                            setCreateColumns(next);
                          }}
                        />
                        Null
                      </label>
                      <input
                        value={col.defaultValue}
                        onChange={(e) => {
                          const next = [...createColumns];
                          next[idx] = {
                            ...col,
                            defaultValue: e.target.value,
                          };
                          setCreateColumns(next);
                        }}
                        placeholder="default (optional)"
                        className={modalInputClass}
                      />
                      <button
                        type="button"
                        disabled={createColumns.length <= 1}
                        onClick={() =>
                          setCreateColumns(
                            createColumns.filter((_, i) => i !== idx)
                          )
                        }
                        className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setCreateColumns([
                        ...createColumns,
                        emptyCreateColumn(false),
                      ])
                    }
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Add column
                  </button>
                </div>
                {createError ? (
                  <p className="text-sm text-red-400">{createError}</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Creates a real PostgreSQL table on the server, owned by this
                    database user.
                  </p>
                )}
                <ModalActions
                  onCancel={() => {
                    setCreateTableOpen(false);
                    setCreateError("");
                  }}
                  submitLabel={
                    creatingTable ? "Creating…" : "Create table on server"
                  }
                  submitting={creatingTable}
                />
              </form>
            ) : null}

            {schemaTables.length === 0 && !createTableOpen ? (
              <p className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                No tables yet. Click Create table to add one on the server.
              </p>
            ) : schemaTables.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
                <div className="max-h-[28rem] space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                  {schemaTables.map((table) => {
                    const key = `${table.schema}.${table.name}`;
                    const active = key === selectedTableKey;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => selectSchemaTable(table)}
                        className={`block w-full rounded-md px-2.5 py-2 text-left text-xs transition ${
                          active
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <span className="block truncate font-medium">
                          {table.schema === "public"
                            ? table.name
                            : `${table.schema}.${table.name}`}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {table.kind}
                          {table.approxRows != null
                            ? ` · ~${table.approxRows} rows`
                            : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="min-w-0 space-y-4">
                  {(() => {
                    const selected = schemaTables.find(
                      (t) => `${t.schema}.${t.name}` === selectedTableKey
                    );
                    if (!selected) {
                      return (
                        <p className="text-sm text-slate-500">
                          Select a table.
                        </p>
                      );
                    }
                    return (
                      <>
                        <div>
                          <p className="text-sm font-medium text-white">
                            {selected.schema}.{selected.name}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {selected.columns.length} columns
                            {selected.approxRows != null
                              ? ` · ~${selected.approxRows} rows`
                              : ""}
                          </p>
                          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800">
                            <table className="min-w-full text-left text-xs">
                              <thead className="bg-slate-900 text-slate-400">
                                <tr>
                                  <th className="px-3 py-2 font-medium">
                                    Column
                                  </th>
                                  <th className="px-3 py-2 font-medium">Type</th>
                                  <th className="px-3 py-2 font-medium">Null</th>
                                  <th className="px-3 py-2 font-medium">
                                    Default
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {selected.columns.map((col) => (
                                  <tr
                                    key={col.name}
                                    className="border-t border-slate-800 text-slate-300"
                                  >
                                    <td className="px-3 py-2 font-mono text-white">
                                      {col.isPrimaryKey ? (
                                        <span className="mr-1 text-[10px] text-amber-300">
                                          PK
                                        </span>
                                      ) : null}
                                      {col.name}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-slate-400">
                                      {col.udtName || col.dataType}
                                    </td>
                                    <td className="px-3 py-2">
                                      {col.nullable ? "YES" : "NO"}
                                    </td>
                                    <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-slate-500">
                                      {col.defaultValue ?? "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div>
                          <p className="text-sm font-medium text-white">
                            Data preview
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            First {preview?.limit ?? 50} rows (read-only)
                          </p>
                          {previewLoading ? (
                            <p className="mt-3 text-sm text-slate-400">
                              Loading rows…
                            </p>
                          ) : previewError ? (
                            <p className="mt-3 text-sm text-red-400">
                              {previewError}
                            </p>
                          ) : !preview || preview.columns.length === 0 ? (
                            <p className="mt-3 text-sm text-slate-500">
                              No columns or rows to show.
                            </p>
                          ) : (
                            <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-800">
                              <table className="min-w-full text-left text-xs">
                                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                                  <tr>
                                    {preview.columns.map((col) => (
                                      <th
                                        key={col}
                                        className="whitespace-nowrap px-3 py-2 font-medium"
                                      >
                                        {col}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {preview.rows.length === 0 ? (
                                    <tr>
                                      <td
                                        colSpan={preview.columns.length}
                                        className="px-3 py-4 text-center text-slate-500"
                                      >
                                        Table is empty.
                                      </td>
                                    </tr>
                                  ) : (
                                    preview.rows.map((row, idx) => (
                                      <tr
                                        key={idx}
                                        className="border-t border-slate-800 text-slate-300"
                                      >
                                        {preview.columns.map((col) => (
                                          <td
                                            key={col}
                                            className="max-w-[14rem] truncate whitespace-nowrap px-3 py-2 font-mono"
                                            title={formatCell(row[col])}
                                          >
                                            {formatCell(row[col])}
                                          </td>
                                        ))}
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : null}
          </div>
        )}
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
                  onClick={() => openSchemaBrowser(db)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Browse
                </button>
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
