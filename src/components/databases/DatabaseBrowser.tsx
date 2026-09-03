"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
  Upload,
} from "lucide-react";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
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
  sizePretty?: string | null;
  indexCount?: number;
  lastUpdated?: string | null;
  columns: SchemaColumn[];
};

type IndexInfo = {
  schema: string;
  table: string;
  name: string;
  unique: boolean;
  definition: string;
};

type RelationInfo = {
  schema: string;
  table: string;
  column: string;
  foreignSchema: string;
  foreignTable: string;
  foreignColumn: string;
  name: string;
};

type FunctionInfo = {
  schema: string;
  name: string;
  args: string;
  returns: string;
  language: string;
};

type TriggerInfo = {
  schema: string;
  table: string;
  name: string;
  timing: string;
  event: string;
  statement: string;
};

type EnumInfo = { schema: string; name: string; labels: string[] };

type TablePreview = {
  columns: string[];
  rows: Record<string, unknown>[];
  limit: number;
};

type MainTab =
  | "data"
  | "structure"
  | "indexes"
  | "relations"
  | "triggers"
  | "permissions";

type ObjectCat =
  | "tables"
  | "views"
  | "functions"
  | "triggers"
  | "enums"
  | "schemas";

const COLUMN_TYPES = [
  { value: "serial", label: "serial" },
  { value: "bigserial", label: "bigserial" },
  { value: "integer", label: "integer" },
  { value: "bigint", label: "bigint" },
  { value: "text", label: "text" },
  { value: "boolean", label: "boolean" },
  { value: "numeric", label: "numeric" },
  { value: "uuid", label: "uuid" },
  { value: "timestamptz", label: "timestamptz" },
  { value: "date", label: "date" },
  { value: "jsonb", label: "jsonb" },
];

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
  const where: Record<string, unknown> = {};
  for (const col of table.columns.filter((c) => c.isPrimaryKey)) {
    where[col.name] = row[col.name];
  }
  return where;
}

function rowKey(table: SchemaTable, row: Record<string, unknown>, index: number) {
  const pks = table.columns.filter((c) => c.isPrimaryKey);
  if (pks.length === 0) return String(index);
  return JSON.stringify(pkWhere(table, row));
}

function isSensitiveColumn(name: string) {
  return /(password|passwd|secret|hash|token|api[_-]?key)/i.test(name);
}

function shortType(col: SchemaColumn) {
  const raw = (col.udtName || col.dataType || "").toLowerCase();
  if (raw === "int4") return "integer";
  if (raw === "int8") return "bigint";
  if (raw === "bool") return "boolean";
  if (raw.includes("timestamp")) return "timestamp";
  if (raw === "varchar" || raw === "bpchar") return "varchar";
  return raw || col.dataType;
}

function formatCount(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function formatAgo(value: string | null | undefined) {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type CreateCol = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
};

function emptyCol(pk = false): CreateCol {
  return {
    name: pk ? "id" : "",
    type: pk ? "serial" : "text",
    nullable: !pk,
    primaryKey: pk,
    defaultValue: "",
  };
}

export default function DatabaseBrowser({ native = false }: { native?: boolean }) {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { confirm, alert } = useAlert();
  const importRef = useRef<HTMLInputElement>(null);

  const [label, setLabel] = useState("");
  const [dbName, setDbName] = useState("");
  const [engine, setEngine] = useState("postgres");
  const [dbSizePretty, setDbSizePretty] = useState<string | null>(null);
  const [pgVersion, setPgVersion] = useState<string | null>(null);
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [relations, setRelations] = useState<RelationInfo[]>([]);
  const [functions, setFunctions] = useState<FunctionInfo[]>([]);
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [enums, setEnums] = useState<EnumInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [cat, setCat] = useState<ObjectCat>("tables");
  const [selectedKey, setSelectedKey] = useState("");
  const [tab, setTab] = useState<MainTab>("data");
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [sqlOpen, setSqlOpen] = useState(false);
  const [sqlText, setSqlText] = useState("SELECT 1;");
  const [sqlBusy, setSqlBusy] = useState(false);
  const [sqlError, setSqlError] = useState("");
  const [sqlResult, setSqlResult] = useState<{
    columns: string[];
    rows: Record<string, unknown>[];
    command: string;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCols, setCreateCols] = useState<CreateCol[]>([
    emptyCol(true),
    emptyCol(false),
  ]);
  const [rowMode, setRowMode] = useState<"add" | "edit" | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editWhere, setEditWhere] = useState<Record<string, unknown> | null>(null);
  const [rowError, setRowError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const tableList = useMemo(
    () =>
      tables.filter(
        (t) => t.kind === "table" || t.kind === "collection" || t.kind === "index"
      ),
    [tables]
  );
  const viewList = useMemo(
    () => tables.filter((t) => t.kind === "view" || t.kind === "materialized_view"),
    [tables]
  );
  const schemas = useMemo(
    () => [...new Set(tables.map((t) => t.schema))].sort(),
    [tables]
  );
  const totalRows = useMemo(
    () => tableList.reduce((sum, t) => sum + (t.approxRows ?? 0), 0),
    [tableList]
  );

  const selected = useMemo(
    () => tables.find((t) => `${t.schema}.${t.name}` === selectedKey) ?? null,
    [tables, selectedKey]
  );

  const q = filter.trim().toLowerCase();
  const sidebarItems = useMemo(() => {
    if (cat === "tables") {
      return tableList
        .filter((t) => !q || t.name.toLowerCase().includes(q))
        .map((t) => ({ key: `${t.schema}.${t.name}`, label: t.name }));
    }
    if (cat === "views") {
      return viewList
        .filter((t) => !q || t.name.toLowerCase().includes(q))
        .map((t) => ({ key: `${t.schema}.${t.name}`, label: t.name }));
    }
    if (cat === "functions") {
      return functions
        .filter((f) => !q || f.name.toLowerCase().includes(q))
        .map((f) => ({
          key: `fn:${f.schema}.${f.name}`,
          label: f.name,
        }));
    }
    if (cat === "triggers") {
      return triggers
        .filter((t) => !q || t.name.toLowerCase().includes(q))
        .map((t) => ({
          key: `tg:${t.schema}.${t.table}.${t.name}`,
          label: t.name,
        }));
    }
    if (cat === "enums") {
      return enums
        .filter((e) => !q || e.name.toLowerCase().includes(q))
        .map((e) => ({ key: `en:${e.schema}.${e.name}`, label: e.name }));
    }
    return schemas
      .filter((s) => !q || s.toLowerCase().includes(q))
      .map((s) => ({ key: `sc:${s}`, label: s }));
  }, [cat, tableList, viewList, functions, triggers, enums, schemas, q]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

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
      setEngine(data.database?.engine || "postgres");
      setDbSizePretty(data.dbSizePretty ?? null);
      setPgVersion(data.pgVersion ?? null);
      const next = (data.tables ?? []) as SchemaTable[];
      setTables(next);
      setIndexes((data.indexes ?? []) as IndexInfo[]);
      setRelations((data.relations ?? []) as RelationInfo[]);
      setFunctions((data.functions ?? []) as FunctionInfo[]);
      setTriggers((data.triggers ?? []) as TriggerInfo[]);
      setEnums((data.enums ?? []) as EnumInfo[]);
      setSelectedKey((prev) => {
        if (prev && next.some((t) => `${t.schema}.${t.name}` === prev)) return prev;
        const first =
          next.find(
            (t) =>
              t.kind === "table" || t.kind === "collection" || t.kind === "index"
          ) ?? next[0];
        return first ? `${first.schema}.${first.name}` : "";
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadPreview = useCallback(
    async (schema: string, table: string) => {
      setPreviewLoading(true);
      setPreview(null);
      setChecked(new Set());
      try {
        const qs = new URLSearchParams({ schema, table, limit: "200" });
        if (search) qs.set("search", search);
        if (filterColumn && filterValue) {
          qs.set("filterColumn", filterColumn);
          qs.set("filterOp", "contains");
          qs.set("filterValue", filterValue);
        }
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
          limit: data.limit ?? 200,
        });
        setPage(0);
      } finally {
        setPreviewLoading(false);
      }
    },
    [id, search, filterColumn, filterValue]
  );

  useEffect(() => {
    if (id) void loadSchema();
  }, [id, loadSchema]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    void loadPreview(selected.schema, selected.name);
    const ident =
      engine === "mysql" || engine === "mariadb"
        ? `\`${selected.name}\``
        : engine === "postgres" || engine === "timescaledb"
          ? `${selected.schema}.${selected.name}`
          : selected.name;
    setSqlText(`SELECT *\nFROM ${ident}\nLIMIT 100;`);
  }, [selected, loadPreview, engine]);

  const pgLike = engine === "postgres" || engine === "timescaledb";
  const sqlCapable = ![
    "redis",
    "mongodb",
    "elasticsearch",
  ].includes(engine);
  const engineLabel =
    engine === "postgres"
      ? "PostgreSQL"
      : engine === "timescaledb"
        ? "TimescaleDB"
        : engine === "mysql"
          ? "MySQL"
          : engine === "mariadb"
            ? "MariaDB"
            : engine === "redis"
              ? "Redis"
              : engine === "sqlite"
                ? "SQLite"
                : engine === "clickhouse"
                  ? "ClickHouse"
                  : engine === "mongodb"
                    ? "MongoDB"
                    : engine;
  const isTable = selected?.kind === "table";
  const hasPk = Boolean(selected?.columns.some((c) => c.isPrimaryKey));
  const canMutateRows = pgLike && isTable && hasPk;

  useEffect(() => {
    if (native && sqlCapable) setSqlOpen(true);
  }, [native, sqlCapable]);
  const pagedRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    const start = page * pageSize;
    return rows.slice(start, start + pageSize);
  }, [preview, page, pageSize]);
  const totalShown = preview?.rows.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalShown / pageSize));

  const tableIndexes = selected
    ? indexes.filter((i) => i.schema === selected.schema && i.table === selected.name)
    : [];
  const tableRelations = selected
    ? relations.filter((r) => r.schema === selected.schema && r.table === selected.name)
    : [];
  const tableTriggers = selected
    ? triggers.filter((t) => t.schema === selected.schema && t.table === selected.name)
    : [];

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

  function openDuplicate(row: Record<string, unknown>) {
    if (!selected) return;
    const next: Record<string, string> = {};
    for (const col of selected.columns) {
      next[col.name] = col.isPrimaryKey ? "" : cellToDraft(row[col.name]);
    }
    setDraft(next);
    setEditWhere(null);
    setRowMode("add");
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
        setRowError(typeof data.error === "string" ? data.error : "Save failed");
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
    if (!hasPk) {
      await alert("This table has no primary key, so rows cannot be deleted.", {
        title: "Cannot delete row",
      });
      return;
    }
    const ok = await confirm("Delete this row? This cannot be undone.", {
      title: "Delete row",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
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
        await alert(typeof data.error === "string" ? data.error : "Delete failed", {
          title: "Error",
        });
        return;
      }
      await loadPreview(selected.schema, selected.name);
      await loadSchema();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTable(table: SchemaTable) {
    if (table.kind !== "table") return;
    const ok = await confirm(
      `Delete table ${table.schema}.${table.name}? All rows in this table will be removed. This cannot be undone.`,
      {
        title: "Delete table",
        danger: true,
        confirmLabel: "Delete table",
      }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({
        schema: table.schema,
        table: table.name,
      });
      const res = await fetch(
        `/api/databases/${encodeURIComponent(id)}/tables?${qs}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alert(
          typeof data.error === "string" ? data.error : "Failed to delete table",
          { title: "Error" }
        );
        return;
      }
      setSelectedKey("");
      await loadSchema();
    } finally {
      setBusy(false);
    }
  }

  async function createTable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(id)}/tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema: "public",
          table: createName.trim(),
          columns: createCols
            .filter((c) => c.name.trim())
            .map((c) => ({
              name: c.name.trim(),
              type: c.type,
              nullable: c.nullable,
              primaryKey: c.primaryKey,
              defaultValue: c.defaultValue.trim() || null,
            })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alert(
          typeof data.error === "string" ? data.error : "Could not create table",
          { title: "Error" }
        );
        return;
      }
      setCreateOpen(false);
      setCreateName("");
      setCreateCols([emptyCol(true), emptyCol(false)]);
      await loadSchema();
      setSelectedKey(`public.${String(data.table || createName.trim())}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportDump(format: "sql" | "custom") {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/databases/${encodeURIComponent(id)}/export?format=${format}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await alert(typeof data.error === "string" ? data.error : "Export failed", {
          title: "Export failed",
          tone: "danger",
          detail: typeof data.detail === "string" ? data.detail : undefined,
        });
        return;
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(dispo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        match?.[1] ||
        `${dbName || "database"}.${format === "custom" ? "dump" : "sql"}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  async function fixOwnership() {
    const ok = await confirm(
      "Make this database’s login role the owner of all public tables, sequences, and functions? Needed so app migrations can ALTER TABLE or CREATE OR REPLACE FUNCTION.",
      { title: "Fix table ownership", confirmLabel: "Fix ownership" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/databases/${encodeURIComponent(id)}/ownership`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alert(
          typeof data.error === "string" ? data.error : "Could not fix ownership",
          {
            title: "Ownership failed",
            tone: "danger",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          }
        );
        return;
      }
      await alert(
        typeof data.message === "string"
          ? data.message
          : "The database role now owns public tables and functions. Restart the app.",
        { title: "Ownership updated", tone: "success" }
      );
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    const ok = await confirm(
      `Import ${file.name} into this database? Existing public tables, functions, and rows will be replaced (same IDs are overwritten).`,
      { title: "Import dump", confirmLabel: "Import and replace", danger: true }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      const res = await fetch(`/api/databases/${encodeURIComponent(id)}/import`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alert(
          typeof data.error === "string" ? data.error : "Import failed",
          {
            title: "Import failed",
            tone: "danger",
            detail: typeof data.detail === "string" ? data.detail : undefined,
          }
        );
        return;
      }
      await alert(
        typeof data.message === "string"
          ? data.message
          : "Dump imported. Existing public objects were replaced.",
        { title: "Imported", tone: "success" }
      );
      await loadSchema();
    } finally {
      setBusy(false);
    }
  }

  async function runSql() {
    setSqlBusy(true);
    setSqlError("");
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(id)}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sqlText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSqlError(typeof data.error === "string" ? data.error : "Query failed");
        setSqlResult(null);
        return;
      }
      setSqlResult({
        command: data.command ?? "SQL",
        columns: data.columns ?? [],
        rows: data.rows ?? [],
      });
      await loadSchema();
      if (selected) await loadPreview(selected.schema, selected.name);
    } finally {
      setSqlBusy(false);
    }
  }

  function toggleReveal(key: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function pagerButtons() {
    const max = pageCount;
    const around = [page - 1, page, page + 1, page + 2, page + 3].filter(
      (n) => n >= 0 && n < max
    );
    const unique = [...new Set([0, ...around, max - 1])].sort((a, b) => a - b);
    return unique;
  }

  if (loading) {
    return (
      <p className={native ? "p-6 text-sm text-slate-400" : "text-sm text-slate-400"}>
        Loading database…
      </p>
    );
  }

  const cats: { id: ObjectCat; label: string; count: number }[] = [
    { id: "tables", label: "Tables", count: tableList.length },
    { id: "views", label: "Views", count: viewList.length },
    { id: "functions", label: "Functions", count: functions.length },
    { id: "triggers", label: "Triggers", count: triggers.length },
    { id: "enums", label: "Enums", count: enums.length },
    { id: "schemas", label: "Schemas", count: schemas.length },
  ];

  const ghost =
    "inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50";
  const primary =
    "inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50";

  return (
    <div
      className={
        native
          ? "flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100"
          : "space-y-6"
      }
    >
      <div
        className={
          native
            ? "flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-4 py-3"
            : "flex flex-wrap items-start justify-between gap-3"
        }
      >
        <div>
          <p className="text-xs text-slate-500">
            <Link href="/dashboard/databases" className="text-emerald-400 hover:text-emerald-300">
              Databases
            </Link>
            {selected ? ` · ${selected.schema}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              {label || dbName || "Database"}
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Online
            </span>
          </div>
          <p className="mt-0.5 font-mono text-xs text-slate-500">
            {dbName}
            {pgVersion ? ` · ${engineLabel} ${pgVersion}` : ` · ${engineLabel}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pgLike ? (
            <button type="button" className={primary} onClick={() => setCreateOpen(true)} disabled={busy}>
              <Plus className="h-3.5 w-3.5" />
              Create table
            </button>
          ) : null}
          {sqlCapable ? (
            <button type="button" className={ghost} onClick={() => setSqlOpen((v) => !v)}>
              <TerminalSquare className="h-3.5 w-3.5" />
              SQL
            </button>
          ) : null}
          {pgLike ? (
            <>
              <button type="button" className={ghost} onClick={() => importRef.current?.click()} disabled={busy}>
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>
              <button type="button" className={ghost} onClick={() => void exportDump("sql")} disabled={busy}>
                <Download className="h-3.5 w-3.5" />
                Export SQL
              </button>
              <button type="button" className={ghost} onClick={() => void exportDump("custom")} disabled={busy}>
                <Download className="h-3.5 w-3.5" />
                Export dump
              </button>
              <button type="button" className={ghost} onClick={() => void fixOwnership()} disabled={busy}>
                <KeyRound className="h-3.5 w-3.5" />
                Fix ownership
              </button>
            </>
          ) : null}
          <button type="button" className={ghost} onClick={() => void loadSchema()} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".sql,.dump,.backup"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>

      {!native ? (
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: "Tables", value: String(tableList.length) },
          { label: "Rows", value: formatCount(totalRows) },
          { label: "Size", value: dbSizePretty || "—" },
          { label: "Objects", value: String(tables.length) },
        ].map((m) => (
          <div
            key={m.label}
            className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {m.label}
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-white">{m.value}</p>
          </div>
        ))}
      </div>
      ) : null}

      {error ? (
        <p
          className={`border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-300 ${
            native ? "mx-4 mt-3 rounded-lg" : "rounded-xl"
          }`}
        >
          {error}
        </p>
      ) : null}

      <div className={native ? "flex shrink-0 flex-wrap gap-1.5 px-4 pt-3" : "flex flex-wrap gap-1.5"}>
        {cats.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCat(c.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              cat === c.id
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
            }`}
          >
            {c.label}
            <span className="ml-1.5 text-slate-500">{c.count}</span>
          </button>
        ))}
      </div>

      <div
        className={
          native
            ? "grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[16rem_minmax(0,1fr)]"
            : "grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]"
        }
      >
        <aside
          className={
            native
              ? "flex min-h-0 flex-col border-r border-slate-800 bg-slate-950 p-2"
              : "rounded-xl border border-slate-800 bg-slate-950/60 p-2"
          }
        >
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={pgLike ? "Search schema / table" : "Search"}
            className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/50"
          />
          <div
            className={
              native
                ? "min-h-0 flex-1 space-y-2 overflow-auto"
                : "max-h-[28rem] space-y-0.5 overflow-auto"
            }
          >
            {(native && pgLike && (cat === "tables" || cat === "views")
              ? [...new Set(sidebarItems.map((item) => item.key.split(".")[0] || "public"))].map(
                  (schema) => ({
                    schema,
                    items: sidebarItems.filter((item) => (item.key.split(".")[0] || "public") === schema),
                  })
                )
              : [{ schema: "", items: sidebarItems }]
            ).map((group) => (
              <div key={group.schema || "all"} className="space-y-0.5">
                {group.schema ? (
                  <p className="sticky top-0 bg-slate-950 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-slate-500">
                    {group.schema}
                  </p>
                ) : null}
            {group.items.map((item) => {
              const table = tableList.find((t) => `${t.schema}.${t.name}` === item.key);
              return (
              <div
                key={item.key}
                className={`flex items-center gap-0.5 rounded-lg ${
                  selectedKey === item.key ? "bg-emerald-500/15" : "hover:bg-slate-800"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedKey(item.key);
                    setTab("data");
                  }}
                  className={`min-w-0 flex-1 px-2.5 py-1.5 text-left text-xs ${
                    selectedKey === item.key ? "text-emerald-300" : "text-slate-300"
                  }`}
                >
                  <span className="block truncate font-mono">{item.label}</span>
                </button>
                {table ? (
                  <button
                    type="button"
                    title="Delete table"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteTable(table);
                    }}
                    className="mr-1 rounded p-1 text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              );
            })}
              </div>
            ))}
            {sidebarItems.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-slate-500">No objects</p>
            ) : null}
          </div>
        </aside>

        <section
          className={
            native
              ? "flex min-h-0 min-w-0 flex-col overflow-hidden bg-slate-950"
              : "min-w-0 rounded-xl border border-slate-800 bg-slate-950/60"
          }
        >
          {selected && !selectedKey.startsWith("fn:") && !selectedKey.startsWith("tg:") && !selectedKey.startsWith("en:") && !selectedKey.startsWith("sc:") ? (
            <div className={native ? "flex min-h-0 flex-1 flex-col" : ""}>
              <div className="border-b border-slate-800 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-mono text-sm text-white">{selected.name}</h3>
                  {isTable ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteTable(selected)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1 text-[11px] text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete table
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <p className="text-[11px] text-slate-500">
                    Rows{" "}
                    <span className="font-medium text-slate-200">
                      {formatCount(selected.approxRows)}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Size{" "}
                    <span className="font-medium text-slate-200">
                      {selected.sizePretty || "—"}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Indexes{" "}
                    <span className="font-medium text-slate-200">
                      {selected.indexCount ?? tableIndexes.length}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Updated{" "}
                    <span className="font-medium text-slate-200">
                      {formatAgo(selected.lastUpdated)}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 border-b border-slate-800 px-2">
                {(
                  (
                    pgLike
                      ? [
                          "data",
                          "structure",
                          "indexes",
                          "relations",
                          "triggers",
                          "permissions",
                        ]
                      : ["data", "structure"]
                  ) as MainTab[]
                ).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    className={`rounded-t-md px-3 py-2 text-xs ${
                      tab === item
                        ? "text-emerald-300"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {item[0]!.toUpperCase() + item.slice(1)}
                  </button>
                ))}
              </div>

              {tab === "data" ? (
                <div className={native ? "flex min-h-0 flex-1 flex-col" : ""}>
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <input
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Search rows"
                      className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white outline-none"
                    />
                    <select
                      value={filterColumn}
                      onChange={(e) => setFilterColumn(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300"
                    >
                      <option value="">Filter column</option>
                      {selected.columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {filterColumn ? (
                      <input
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                        placeholder="Value"
                        className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"
                      />
                    ) : null}
                    {pgLike ? (
                    <button type="button" className={primary} onClick={openAdd} disabled={busy || !canMutateRows}>
                      <Plus className="h-3.5 w-3.5" />
                      Add row
                    </button>
                    ) : null}
                  </div>
                  {rowMode ? (
                    <form className="flex flex-wrap gap-2 border-t border-slate-800 px-3 py-2" onSubmit={saveRow}>
                      {selected.columns.map((col) => (
                        <label key={col.name} className="min-w-[8rem] flex-1">
                          <span className="mb-1 block text-[10px] text-slate-500">{col.name}</span>
                          <input
                            className={modalInputClass}
                            value={draft[col.name] ?? ""}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, [col.name]: e.target.value }))
                            }
                          />
                        </label>
                      ))}
                      <button type="submit" className={primary} disabled={busy}>
                        Save
                      </button>
                      <button type="button" className={ghost} onClick={() => setRowMode(null)}>
                        Cancel
                      </button>
                      {rowError ? (
                        <span className="text-xs text-red-400">{rowError}</span>
                      ) : null}
                    </form>
                  ) : null}
                  <div className={native ? "min-h-0 flex-1 overflow-auto px-3 pb-3" : "overflow-auto px-3 pb-3"}>
                    {previewLoading ? (
                      <p className="py-8 text-center text-sm text-slate-500">Loading rows…</p>
                    ) : !preview || preview.rows.length === 0 ? (
                      <p className="py-8 text-center text-sm text-slate-500">No rows.</p>
                    ) : (
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-900 text-slate-400">
                          <tr>
                            {preview.columns.map((c) => {
                              const meta = selected.columns.find((col) => col.name === c);
                              return (
                                <th key={c} className="whitespace-nowrap px-2 py-2 font-medium">
                                  {c}
                                  <span className="ml-1 font-normal text-slate-600">
                                    {meta ? shortType(meta) : ""}
                                  </span>
                                </th>
                              );
                            })}
                            {pgLike ? <th className="px-2 py-2"> </th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {pagedRows.map((row, i) => {
                            const key = rowKey(selected, row, page * pageSize + i);
                            return (
                              <tr key={key} className="border-t border-slate-800 text-slate-200">
                                {preview.columns.map((c) => {
                                  const secret = isSensitiveColumn(c);
                                  const open = revealed.has(`${key}:${c}`);
                                  const raw = formatCell(row[c]);
                                  return (
                                    <td
                                      key={c}
                                      className={`max-w-[14rem] truncate px-2 py-1.5 font-mono ${
                                        row[c] == null ? "italic text-slate-600" : ""
                                      }`}
                                      title={secret && !open ? "" : raw}
                                    >
                                      {secret ? (
                                        <span className="inline-flex items-center gap-1">
                                          {open ? raw : "••••••••"}
                                          <button
                                            type="button"
                                            onClick={() => toggleReveal(`${key}:${c}`)}
                                            className="text-slate-500 hover:text-white"
                                          >
                                            {open ? (
                                              <EyeOff className="h-3.5 w-3.5" />
                                            ) : (
                                              <Eye className="h-3.5 w-3.5" />
                                            )}
                                          </button>
                                        </span>
                                      ) : (
                                        raw
                                      )}
                                    </td>
                                  );
                                })}
                                {pgLike ? (
                                <td className="whitespace-nowrap px-2 py-1.5">
                                  <button
                                    type="button"
                                    disabled={busy || !canMutateRows}
                                    onClick={() => openEdit(row)}
                                    className="mr-1 text-sky-400 hover:text-sky-300 disabled:opacity-40"
                                    title="Edit"
                                  >
                                    <Pencil className="inline h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy || !canMutateRows}
                                    onClick={() => openDuplicate(row)}
                                    className="mr-1 text-slate-400 hover:text-white disabled:opacity-40"
                                    title="Duplicate"
                                  >
                                    <Copy className="inline h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy || !canMutateRows}
                                    onClick={() => void deleteRow(row)}
                                    className="text-red-400 hover:text-red-300 disabled:opacity-40"
                                    title="Delete"
                                  >
                                    <Trash2 className="inline h-3.5 w-3.5" />
                                  </button>
                                </td>
                                ) : null}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                  {preview && preview.rows.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
                      <span>
                        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalShown)} of{" "}
                        {formatCount(selected.approxRows ?? totalShown)}
                      </span>
                      <select
                        value={String(pageSize)}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(0);
                        }}
                        className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-xs"
                      >
                        {[10, 25, 50, 100].map((n) => (
                          <option key={n} value={n}>
                            {n} / page
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className={ghost}
                          disabled={page <= 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          className={ghost}
                          disabled={page + 1 >= pageCount}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "structure" ? (
                <div className="overflow-auto p-3">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5">Column</th>
                        <th className="px-2 py-1.5">Type</th>
                        <th className="px-2 py-1.5">Null</th>
                        <th className="px-2 py-1.5">Default</th>
                        <th className="px-2 py-1.5">Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.columns.map((c) => (
                        <tr key={c.name} className="border-t border-slate-800">
                          <td className="px-2 py-1.5 font-mono text-slate-200">{c.name}</td>
                          <td className="px-2 py-1.5 text-slate-400">{shortType(c)}</td>
                          <td className="px-2 py-1.5">{c.nullable ? "YES" : "NO"}</td>
                          <td className="px-2 py-1.5 text-slate-500">{c.defaultValue || "—"}</td>
                          <td className="px-2 py-1.5 text-emerald-300">
                            {c.isPrimaryKey ? "PK" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === "indexes" ? (
                <div className="overflow-auto p-3">
                  {tableIndexes.length === 0 ? (
                    <p className="text-sm text-slate-500">No indexes.</p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {tableIndexes.map((idx) => (
                        <li key={idx.name} className="rounded-xl border border-slate-800 px-3 py-2">
                          <p className="font-mono text-slate-200">{idx.name}</p>
                          <p className="mt-1 text-slate-500">{idx.definition}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {tab === "relations" ? (
                <div className="overflow-auto p-3">
                  {tableRelations.length === 0 ? (
                    <p className="text-sm text-slate-500">No foreign keys.</p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {tableRelations.map((r) => (
                        <li key={r.name + r.column} className="rounded-xl border border-slate-800 px-3 py-2">
                          {r.column} → {r.foreignTable}.{r.foreignColumn}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {tab === "triggers" ? (
                <div className="p-3 text-sm text-slate-500">
                  {tableTriggers.length === 0
                    ? "No triggers."
                    : tableTriggers.map((t) => (
                        <p key={t.name} className="font-mono text-xs text-slate-300">
                          {t.name} · {t.timing} {t.event}
                        </p>
                      ))}
                </div>
              ) : null}

              {tab === "permissions" && pgLike ? (
                <div className="space-y-3 p-4 text-sm text-slate-400">
                  <p>
                    App logins use this database’s PostgreSQL role. Migrations that{" "}
                    <span className="font-mono text-xs">ALTER TABLE</span> need that role to{" "}
                    <span className="font-medium text-slate-200">own</span> the table.
                  </p>
                  <button
                    type="button"
                    className={ghost}
                    onClick={() => void fixOwnership()}
                    disabled={busy}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Make role owner of public tables
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-slate-500">
              Select a table to browse rows.
            </p>
          )}
        </section>
      </div>

      {sqlOpen ? (
        <section
          className={
            native
              ? "shrink-0 border-t border-slate-800 bg-slate-950 p-3"
              : "rounded-xl border border-slate-800 bg-slate-950/60 p-3"
          }
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">SQL</h3>
            <button type="button" className="text-xs text-slate-500" onClick={() => setSqlOpen(false)}>
              Hide
            </button>
          </div>
          <textarea
            value={sqlText}
            onChange={(e) => setSqlText(e.target.value)}
            spellCheck={false}
            className={`w-full rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-slate-100 outline-none focus:border-emerald-500/50 ${
              native ? "min-h-[5rem]" : "min-h-[7rem]"
            }`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={primary} onClick={() => void runSql()} disabled={sqlBusy}>
              {sqlBusy ? "Running…" : "Run"}
            </button>
            <button
              type="button"
              className={ghost}
              onClick={() => {
                setSqlText("");
                setSqlResult(null);
                setSqlError("");
              }}
            >
              Clear
            </button>
            {sqlError ? <span className="text-xs text-red-400">{sqlError}</span> : null}
            {sqlResult ? (
              <span className="text-xs text-slate-500">
                {sqlResult.command}
                {sqlResult.rows.length ? ` · ${sqlResult.rows.length} rows` : ""}
              </span>
            ) : null}
          </div>
          {sqlResult && sqlResult.columns.length > 0 ? (
            <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-800">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                  <tr>
                    {sqlResult.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sqlResult.rows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-800 text-slate-200">
                      {sqlResult.columns.map((c) => (
                        <td
                          key={c}
                          className="max-w-[16rem] truncate px-2 py-1 font-mono"
                          title={formatCell(row[c])}
                        >
                          {formatCell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create table">
        <form onSubmit={createTable} className="space-y-3">
          <label className="block">
            <span className={modalLabelClass}>Table name</span>
            <input
              className={modalInputClass}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              required
              pattern="[A-Za-z_][A-Za-z0-9_]*"
              maxLength={63}
            />
          </label>
          {createCols.map((col, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
              <input
                className={modalInputClass}
                value={col.name}
                onChange={(e) => {
                  const next = [...createCols];
                  next[idx] = { ...col, name: e.target.value };
                  setCreateCols(next);
                }}
                placeholder="column"
                required
              />
              <select
                className={modalInputClass}
                value={col.type}
                onChange={(e) => {
                  const next = [...createCols];
                  next[idx] = { ...col, type: e.target.value };
                  setCreateCols(next);
                }}
              >
                {COLUMN_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={col.primaryKey}
                  onChange={(e) => {
                    const next = createCols.map((c, i) =>
                      i === idx
                        ? {
                            ...c,
                            primaryKey: e.target.checked,
                            nullable: e.target.checked ? false : c.nullable,
                          }
                        : c
                    );
                    setCreateCols(next);
                  }}
                />
                PK
              </label>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-sky-400"
            onClick={() => setCreateCols([...createCols, emptyCol(false)])}
          >
            Add column
          </button>
          <div className="flex justify-end gap-2">
            <button type="button" className={ghost} onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" className={primary} disabled={busy}>
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
