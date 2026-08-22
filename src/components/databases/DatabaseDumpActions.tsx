"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useAlert } from "@/components/ui/alert-provider";

export function DatabaseDumpActions(props: {
  databaseId: string;
  onImported?: () => void;
}) {
  const { databaseId, onImported } = props;
  const { confirm, alert } = useAlert();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"sql" | "custom" | "import" | null>(null);

  async function exportDump(format: "sql" | "custom") {
    setBusy(format);
    try {
      const res = await fetch(
        `/api/databases/${encodeURIComponent(databaseId)}/export?format=${format}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await alert(
          typeof data.error === "string" ? data.error : "Export failed",
          { title: "Export failed", tone: "danger" }
        );
        return;
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(dispo);
      const name =
        match?.[1] ||
        (format === "custom" ? "database.dump" : "database.sql");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File) {
    const ok = await confirm(
      `Import ${file.name} into this database? Existing public tables, functions, and rows will be replaced (same IDs are overwritten).`,
      { title: "Import dump", confirmLabel: "Import and replace", danger: true }
    );
    if (!ok) return;

    setBusy("import");
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      const res = await fetch(
        `/api/databases/${encodeURIComponent(databaseId)}/import`,
        { method: "POST", body: fd, credentials: "include" }
      );
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
          : "Dump imported.",
        { title: "Imported", tone: "success" }
      );
      onImported?.();
    } finally {
      setBusy(null);
    }
  }

  const disabled = Boolean(busy);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => void exportDump("sql")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {busy === "sql" ? "Exporting…" : "Export SQL"}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void exportDump("custom")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {busy === "custom" ? "Exporting…" : "Export dump"}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" />
        {busy === "import" ? "Importing…" : "Import"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".sql,.dump,.backup,application/sql,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
    </div>
  );
}
