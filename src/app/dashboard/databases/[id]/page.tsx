"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Pencil, Plus, Table2, Trash2 } from "lucide-react";
import { modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";

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

function cellToDraft(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseDraft(col: SchemaColumn, raw: string): unknown {
  const text = raw.trim();
  if (text === "") return "";
  const t = (col.udtName || col.dataType).toLowerCase();
  if (t.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (t === "bool" || t === "boolean") {
    if (text === "true" || text === "t" || text === "1") return true;
    if (text === "false" || text === "f" || text === "0") return false;
  }
  if (
    t.includes("int") ||
    t === "numeric" ||
    t === "float8" ||
    t === "float4" ||
    t === "real"
  ) {
    const n = Number(text);
    if (Number.isFinite(n) && text !== "") return n;
  }
  return text;
}

function pkWhere(table: SchemaTable, row: Record<string, unknown>) {
  const pks = table.columns.filter((c) => c.isPrimaryKey);
  const where: Record<string, unknown> = {};
  for (const col of pks) where[col.name] = row[col.name];
  return where;
}

export default function DatabaseBrowsePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { confirm, alert } = useAlert();
  const [label, setLabel] = useState("");
  const [dbName, setDbName] = useState("");
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState("");
  const [rowMode, setRowMode] = useState<"add" | "edit" | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editWhere, setEditWhere] = useState<Record<string, unknown> | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => tables.find((t) => `${t.schema}.${t.name}` === selectedKey) ?? null,
    [tables, selectedKey]
  );

  const loadPreview = useCallback(async (schema: string, table: string) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const qs = new URLSearchParams({ schema, table, limit: "100" });
      const res = await fetch(
        `/api/databases/${encodeURIComponent(id)}/preview?${qs}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Failed to load rows"
        );
        return;
      }
      setPreview({
        columns: data.columns ?? [],
        rows: data.rows ?? [],
        limit: data.limit ?? 100,
      });
    } finally {
      setPreviewLoading(false);
    }
  }, [id]);

  const loadSchema = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(id)}/schema`);
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Failed to load schema"
        );
        return;
      }
      setLabel(data.database?.label ?? "Database");
      setDbName(data.database?.dbName ?? "");
      const next = (data.tables ?? []) as SchemaTable[];
      setTables(next);
      setSelectedKey((prev) => {
        if (prev && next.some((t) => `${t.schema}.${t.name}` === prev)) {
          return prev;
        }
        return next[0] ? `${next[0].schema}.${next[0].name}` : "";
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void loadSchema();
  }, [id, loadSchema]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    void loadPreview(selected.schema, selected.name);
  }, [selected, loadPreview]);

  function openAdd() {
    if (!selected) return;
    const next: Record<string, string> = {};
    for (const col of selected.columns) next[col.name] = "";
    setDraft(next);
    setEditWhere(null);
    setRowMode("add");
    setRowError("");
  }

  function openEdit(row: Record<string, unknown>) {
    if (!selected) return;
    const next: Record<string, string> = {};
    for (const col of selected.columns) next[col.name] = cellToDraft(row[col.name]);
    setDraft(next);
    setEditWhere(pkWhere(selected, row));
    setRowMode("edit");
    setRowError("");
  }

  async function saveRow(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const values: Record<string, unknown> = {};
    for (const col of selected.columns) {
      values[col.name] = parseDraft(col, draft[col.name] ?? "");
    }
    setBusy(true);
    setRowError("");
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(id)}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: selected.schema,
          table: selected.name,
          op: rowMode === "edit" ? "update" : "insert",
          values,
          where: rowMode === "edit" ? editWhere ?? {} : {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError(
          typeof data.error === "string" ? data.error : "Save failed"
        );
        return;
      }
      setRowMode(null);
      await loadPreview(selected.schema, selected.name);
      await loadSchema();
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(row: Record<string, unknown>) {
    if (!selected) return;
    const pks = selected.columns.filter((c) => c.isPrimaryKey);
    if (pks.length === 0) {
      await alert("This table has no primary key, so rows cannot be deleted from the panel.", {
        title: "Cannot delete row",
      });
      return;
    }
    const ok = await confirm("Delete this row? This cannot be undone.", {
      title: "Delete row",
      danger: true,
      confirmLabel: "Delete row",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(id)}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: selected.schema,
          table: selected.name,
          op: "delete",
          where: pkWhere(selected, row),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alert(
          typeof data.error === "string" ? data.error : "Failed to delete row",
          { title: "Error" }
        );
        return;
      }
      await loadPreview(selected.schema, selected.name);
      await loadSchema();
    } finally {
      setBusy(false);
    }
  }

  const isTable = selected?.kind === "table";
  const hasPk = Boolean(selected?.columns.some((c) => c.isPrimaryKey));

  return (
    <div className="space-y-4">
      <PageHeader
        title={label ? `Browse · ${label}` : "Browse database"}
        description={dbName}
      />
      <p className="text-sm text-slate-400">
        <Link href="/dashboard/databases" className="text-sky-400 hover:text-sky-300">
          ← Databases
        </Link>
        {dbName ? (
          <span className="ml-2 font-mono text-xs text-slate-500">{dbName}</span>
        ) : null}
      </p>

      {loading ? (
        <p className="text-sm text-slate-400">Loading schema…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <aside className="rounded-xl border border-slate-800 bg-slate-950/80 p-2">
            <p className="px-2 py-1 text-xs text-slate-500">
              {tables.length} table{tables.length === 1 ? "" : "s"}
            </p>
            <div className="max-h-[70vh] space-y-0.5 overflow-auto">
              {tables.map((t) => {
                const key = `${t.schema}.${t.name}`;
                const active = key === selectedKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                      active
                        ? "bg-sky-500/15 text-sky-200"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <Table2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-mono">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-w-0 space-y-4 rounded-xl border border-slate-800 bg-slate-950/80 p-4">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm text-white">
                      {selected.schema}.{selected.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selected.columns.length} columns
                      {selected.approxRows != null
                        ? ` · ~${selected.approxRows} rows`
                        : ""}
                    </p>
                  </div>
                  {isTable ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={openAdd}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add row
                    </button>
                  ) : null}
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400">
                      <tr>
                        {selected.columns.map((c) => (
                          <th key={c.name} className="px-2 py-1.5 font-medium">
                            {c.isPrimaryKey ? "PK " : ""}
                            {c.name}
                            <span className="ml-1 text-slate-600">
                              {c.udtName || c.dataType}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                </div>

                {rowMode ? (
                  <form
                    onSubmit={saveRow}
                    className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3"
                  >
                    <p className="text-xs font-medium text-slate-300">
                      {rowMode === "add" ? "Add row" : "Update row"}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selected.columns.map((col) => (
                        <label key={col.name} className="block">
                          <span className={modalLabelClass}>
                            {col.name}
                            {col.isPrimaryKey ? " (PK)" : ""}
                            {col.defaultValue ? " · optional" : ""}
                          </span>
                          <input
                            className={modalInputClass}
                            value={draft[col.name] ?? ""}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                [col.name]: e.target.value,
                              }))
                            }
                            placeholder={
                              col.defaultValue ? "leave empty for default" : ""
                            }
                          />
                        </label>
                      ))}
                    </div>
                    {rowError ? (
                      <p className="text-sm text-red-400">{rowError}</p>
                    ) : null}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={busy}
                        className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRowMode(null)}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}

                <div>
                  <p className="mb-2 text-xs font-medium text-slate-300">
                    Table data
                    {preview ? ` · first ${preview.limit} rows` : ""}
                  </p>
                  {!hasPk && isTable ? (
                    <p className="mb-2 text-xs text-amber-400">
                      Add/update/delete need a primary key on this table.
                    </p>
                  ) : null}
                  {previewLoading ? (
                    <p className="text-sm text-slate-400">Loading rows…</p>
                  ) : preview && preview.rows.length === 0 ? (
                    <p className="text-sm text-slate-500">No rows.</p>
                  ) : preview ? (
                    <div className="overflow-auto rounded-lg border border-slate-800">
                      <table className="min-w-full text-left text-xs">
                        <thead className="sticky top-0 bg-slate-900 text-slate-400">
                          <tr>
                            {preview.columns.map((c) => (
                              <th key={c} className="whitespace-nowrap px-2 py-1.5">
                                {c}
                              </th>
                            ))}
                            <th className="px-2 py-1.5">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, i) => (
                            <tr
                              key={i}
                              className="border-t border-slate-800 text-slate-200"
                            >
                              {preview.columns.map((c) => (
                                <td
                                  key={c}
                                  className="max-w-[14rem] truncate px-2 py-1.5 font-mono"
                                  title={formatCell(row[c])}
                                >
                                  {formatCell(row[c])}
                                </td>
                              ))}
                              <td className="whitespace-nowrap px-2 py-1.5">
                                <button
                                  type="button"
                                  disabled={busy || !hasPk}
                                  onClick={() => openEdit(row)}
                                  className="mr-1 inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-sky-300 hover:bg-slate-800 disabled:opacity-40"
                                >
                                  <Pencil className="h-3 w-3" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || !hasPk}
                                  onClick={() => void deleteRow(row)}
                                  className="inline-flex items-center gap-1 rounded border border-red-500/30 px-1.5 py-0.5 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">No tables in this database.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
