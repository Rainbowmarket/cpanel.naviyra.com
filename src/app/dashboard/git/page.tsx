"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { modalInputClass, modalLabelClass } from "@/components/ui/modal";

type GitSite = {
  kind: "domain" | "subdomain";
  id: string;
  hostname: string;
  documentRoot: string;
  repoUrl: string;
  branch: string;
  lastCommit: string | null;
  lastStatus: string;
  lastError: string | null;
  lastDeployAt: string | null;
};

function targetId(s: GitSite) {
  return `${s.kind}:${s.id}`;
}

export default function GitDeployPage() {
  const [sites, setSites] = useState<GitSite[]>([]);
  const [selected, setSelected] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/git-deploy");
    const data = await res.json();
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to load sites");
      return;
    }
    const list = (data.sites ?? []) as GitSite[];
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

  useEffect(() => {
    if (!site) return;
    setRepoUrl(site.repoUrl);
    setBranch(site.branch || "main");
  }, [site]);

  async function deploy(e: FormEvent) {
    e.preventDefault();
    if (!site) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/git-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: site.kind,
          id: site.id,
          repoUrl,
          branch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Deploy failed");
        return;
      }
      setMessage(
        data.deployment?.lastCommit
          ? `Deployed ${data.deployment.lastCommit}`
          : "Deploy finished"
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Git Deployments" description="Pull a repository into a site folder" />
      <p className="text-sm text-slate-400">
        Clone or fast-forward the site document root from Git. Hooks are disabled. The folder must
        be empty for a first clone, or already be a git checkout.
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}

      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
        <label className="mb-1.5 block text-xs text-slate-400">Site</label>
        <Select
          value={selected}
          onChange={setSelected}
          options={sites.map((s) => ({
            value: targetId(s),
            label: s.hostname,
          }))}
          placeholder="Select site"
        />
      </div>

      {site ? (
        <form onSubmit={deploy} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/80 p-4">
          <p className="text-xs text-slate-500">
            Path <span className="font-mono text-slate-400">{site.documentRoot}</span>
            {site.lastStatus !== "idle" ? ` · last ${site.lastStatus}` : ""}
            {site.lastCommit ? ` · ${site.lastCommit}` : ""}
            {site.lastDeployAt
              ? ` · ${new Date(site.lastDeployAt).toLocaleString()}`
              : ""}
          </p>
          {site.lastError ? (
            <p className="text-xs text-red-400">{site.lastError}</p>
          ) : null}
          <label className="block">
            <span className={modalLabelClass}>Repository URL</span>
            <input
              className={modalInputClass}
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://x-access-token:TOKEN@github.com/org/app.git"
              required
            />
          </label>
          <label className="block max-w-xs">
            <span className={modalLabelClass}>Branch</span>
            <input
              className={modalInputClass}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy ? (
              "Deploying…"
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Save and deploy
              </>
            )}
          </button>
          <p className="flex items-center gap-1 text-[11px] text-slate-500">
            <GitBranch className="h-3 w-3" />
            Uses git clone --depth 1 or fetch + checkout FETCH_HEAD. Private GitHub
            repos: Contents permission on the token, and one slash after github.com
            (github.com/org/repo.git, not github.com//org/…).
          </p>
        </form>
      ) : (
        <p className="text-sm text-slate-500">No sites to deploy to.</p>
      )}
    </div>
  );
}
