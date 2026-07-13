"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, FolderOpen } from "lucide-react";
import { Select } from "@/components/ui/select";
import { buildFileManagerUrl, getFileManagerBaseUrl, openFileManager } from "@/lib/file-manager";

type Domain = { id: string; name: string; documentRoot: string };

export default function FilesPageContent() {
  const searchParams = useSearchParams();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState("");

  const selectedDomain = domains.find((d) => d.id === domainId);
  const paramPath = searchParams.get("path");
  const openPath = paramPath || selectedDomain?.documentRoot;

  useEffect(() => {
    const paramDomainId = searchParams.get("domainId");

    fetch("/api/domains")
      .then((r) => r.json())
      .then((d) => {
        const list = d.domains ?? [];
        setDomains(list);

        if (paramDomainId && list.some((x: Domain) => x.id === paramDomainId)) {
          setDomainId(paramDomainId);
        } else if (list[0]) {
          setDomainId(list[0].id);
        }
      });
  }, [searchParams]);

  useEffect(() => {
    if (!searchParams.get("open")) return;
    if (!openPath) return;
    openFileManager({ path: openPath });
  }, [searchParams, openPath]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">File Manager</h2>
        <p className="text-slate-400">
          Browse and edit website files in{" "}
          <span className="font-mono text-emerald-400/90">{getFileManagerBaseUrl()}</span>.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Domain
            </label>
            <Select
              value={domainId}
              onChange={setDomainId}
              options={domains.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Choose domain..."
            />
          </div>

          <button
            type="button"
            onClick={() => openPath && openFileManager({ path: openPath })}
            disabled={!openPath}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" />
            Open File Manager
          </button>
        </div>

        {openPath && (
          <p className="mt-4 font-mono text-xs text-slate-500">
            Opens in a new window at: {buildFileManagerUrl({ path: openPath })}
          </p>
        )}

        <div className="mt-6 flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <FolderOpen className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div className="text-sm text-slate-400">
            <p className="text-slate-300">Powered by WebEditer</p>
            <p className="mt-1">
              Upload, download, rename, and edit files with syntax highlighting. Sign in with your
              WebEditer account when prompted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
