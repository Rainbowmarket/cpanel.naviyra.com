"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  serverHostname?: string;
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
      const fromUrl =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("site")
          : null;
      if (fromUrl && list.some((s) => targetId(s) === fromUrl)) return fromUrl;
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
    <div className="space-y-6">
      <PageHeader
        title="App Deployment"
        description="Upload code, set a startup file, and start your app."
      />

      <div className="max-w-md">
        <label className="mb-1.5 block text-xs font-medium text-slate-400">
          Application
        </label>
        <Select
          value={selected}
          onChange={setSelected}
          options={sites.map((s) => ({
            value: targetId(s),
            label: s.serverHostname
              ? `${s.hostname} (${s.serverHostname})`
              : s.hostname,
          }))}
          placeholder={sites.length ? "Choose a site…" : "No sites yet"}
        />
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {site ? (
        <AppRuntimeControls
          key={targetId(site)}
          kind={site.kind}
          id={site.id}
          hostname={site.hostname}
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
        <p className="rounded-2xl border border-dashed border-slate-800 px-5 py-14 text-center text-sm text-slate-500">
          Add a domain first, then deploy Node, Python, PHP, or Go here.
        </p>
      )}
    </div>
  );
}
