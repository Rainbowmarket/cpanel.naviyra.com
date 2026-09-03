"use client";

import { useCallback, useEffect, useState } from "react";
import { Container, Play, RefreshCw, Square, Terminal } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useAlert } from "@/components/ui/alert-provider";

type ContainerRow = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
};

type AppSite = { kind: "domain" | "subdomain"; id: string; hostname: string };

export default function DockerPage() {
  const { alert } = useAlert();
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [available, setAvailable] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [sites, setSites] = useState<AppSite[]>([]);
  const [site, setSite] = useState("");
  const [logs, setLogs] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [dockerRes, appsRes] = await Promise.all([
      fetch("/api/docker"),
      fetch("/api/apps"),
    ]);
    const docker = await dockerRes.json();
    if (!dockerRes.ok) {
      setError(typeof docker.error === "string" ? docker.error : "Failed to list containers");
      return;
    }
    setError("");
    setContainers(docker.containers ?? []);
    setAvailable(docker.available !== false);
    setDryRun(Boolean(docker.dryRun));
    if (appsRes.ok) {
      const apps = await appsRes.json();
      const list = (apps.sites ?? []) as AppSite[];
      setSites(list);
      setSite((prev) => prev || (list[0] ? `${list[0].kind}:${list[0].id}` : ""));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runOp(id: string, op: "start" | "stop" | "restart" | "logs") {
    setBusy(`${op}:${id}`);
    setError("");
    try {
      const res = await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, id }),
      });
      const data = await res.json();
      if (!res.ok) {
        await alert(typeof data.error === "string" ? data.error : "Docker action failed", {
          title: "Docker",
        });
        return;
      }
      if (op === "logs") setLogs(data.logs || "(empty)");
      else await load();
    } finally {
      setBusy("");
    }
  }

  async function composeUp() {
    const [kind, id] = site.split(":");
    if (!kind || !id) return;
    setBusy("compose");
    setError("");
    try {
      const res = await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "compose",
          kind,
          siteId: id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        await alert(
          typeof data.error === "string" ? data.error : "Compose up failed",
          { title: "Docker Compose" }
        );
        return;
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Docker"
        description="Manage containers on this host"
      />
      <p className="text-sm text-slate-400">
        Lists Docker containers on the panel host. Compose up looks for{" "}
        <span className="font-mono">docker-compose.yml</span> in the selected site folder.
      </p>
      {dryRun ? (
        <p className="text-xs text-amber-300">Dry-run: Docker commands are not executed on Windows/dev.</p>
      ) : null}
      {!available && !dryRun ? (
        <p className="text-sm text-amber-300">Docker is not available on this server.</p>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1 block text-xs text-slate-500">Site for compose up</label>
          <Select
            value={site}
            onChange={setSite}
            options={sites.map((s) => ({
              value: `${s.kind}:${s.id}`,
              label: s.hostname,
            }))}
            placeholder="Select site"
          />
        </div>
        <button
          type="button"
          disabled={!site || Boolean(busy)}
          onClick={() => void composeUp()}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          Compose up -d
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="overflow-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Image</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Ports</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {containers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No containers.
                </td>
              </tr>
            ) : (
              containers.map((c) => (
                <tr key={c.id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 font-mono">
                    <span className="inline-flex items-center gap-1">
                      <Container className="h-3.5 w-3.5 text-emerald-400" />
                      {c.name || c.id.slice(0, 12)}
                    </span>
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-slate-400" title={c.image}>
                    {c.image}
                  </td>
                  <td className="px-3 py-2">{c.state || c.status}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2 text-slate-500">{c.ports || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void runOp(c.id, "start")}
                      className="mr-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-emerald-300 hover:bg-slate-800"
                    >
                      <Play className="mr-0.5 inline h-3 w-3" />
                      Start
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void runOp(c.id, "stop")}
                      className="mr-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-amber-300 hover:bg-slate-800"
                    >
                      <Square className="mr-0.5 inline h-3 w-3" />
                      Stop
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void runOp(c.id, "restart")}
                      className="mr-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-emerald-300 hover:bg-slate-800"
                    >
                      Restart
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void runOp(c.id, "logs")}
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      <Terminal className="mr-0.5 inline h-3 w-3" />
                      Logs
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {logs ? (
        <pre className="max-h-80 overflow-auto rounded-xl border border-slate-800 bg-black/40 p-3 text-[11px] text-slate-300">
          {logs}
        </pre>
      ) : null}
    </div>
  );
}
