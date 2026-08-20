"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, FolderOpen } from "lucide-react";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { AppRuntimeControls } from "@/components/apps/AppRuntimeControls";

type AppSite = {
  kind: "domain" | "subdomain";
  id: string;
  hostname: string;
  documentRoot: string;
  appType: "STATIC" | "PHP" | "PYTHON" | "GO" | "NODE";
  startCommand?: string | null;
  appStartupFile?: string | null;
  appWorkingDir?: string | null;
  upstreamPort?: number | null;
  appStatus?: string | null;
  appEnv?: string | null;
};

function targetId(site: AppSite) {
  return `${site.kind}:${site.id}`;
}

export default function AppsPage() {
  const [sites, setSites] = useState<AppSite[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/apps");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load sites");
      return;
    }
    const list = (data.sites ?? []) as AppSite[];
    setSites(list);
    setSelected((prev) => {
      if (prev && list.some((s) => targetId(s) === prev)) return prev;
      return list[0] ? targetId(list[0]) : "";
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const site = useMemo(
    () => sites.find((s) => targetId(s) === selected) ?? null,
    [sites, selected]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Apps"
        description="Start Node, Python, or Go backends for a domain. Nginx proxies HTTPS to the process."
      />

      <p className="text-sm text-slate-400">
        Select a domain or subdomain, upload code in Files, set the startup
        file, then Start. The panel allocates a localhost port (12000–12999)
        and rewrites nginx — you do not need a manual{" "}
        <span className="font-mono">proxy_pass</span> to :8000.
      </p>

      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
        <label className="mb-1.5 block text-xs font-medium text-slate-400">
          Site
        </label>
        <Select
          value={selected}
          onChange={setSelected}
          options={sites.map((s) => ({
            value: targetId(s),
            label: `${s.hostname} · ${s.appType}${
              s.upstreamPort ? ` :${s.upstreamPort}` : ""
            }${s.appStatus === "RUNNING" ? " · running" : ""}`,
          }))}
          placeholder={sites.length ? "Choose a site…" : "No sites yet"}
        />
        {site ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{site.documentRoot}</span>
            <a
              href={`/file-manager?target=${site.kind === "subdomain" ? "s" : "d"}:${site.id}`}
              className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Upload files
            </a>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {site ? (
        <AppRuntimeControls
          key={targetId(site)}
          kind={site.kind}
          id={site.id}
          applicationUrl={`https://${site.hostname}`}
          appType={site.appType ?? "PHP"}
          startCommand={site.startCommand}
          appStartupFile={site.appStartupFile}
          appWorkingDir={site.appWorkingDir}
          upstreamPort={site.upstreamPort}
          appStatus={site.appStatus}
          appEnv={site.appEnv}
          documentRoot={site.documentRoot}
          onUpdated={() => void load()}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-800 px-5 py-10 text-center text-sm text-slate-500">
          Add a domain first, then start a Node, Python, or Go app here.
        </p>
      )}

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        FastAPI: click “Use FastAPI / uvicorn”. Node: server.js must listen on
        process.env.PORT. Go: bind 127.0.0.1 and os.Getenv(&quot;PORT&quot;).
      </p>
    </div>
  );
}
