"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, FolderOpen, Globe, Lock, RefreshCw, Settings2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import {
  AppRuntimeControls,
  AppTypeSelectField,
  type AppType,
} from "@/components/apps/AppRuntimeControls";

type Domain = {
  id: string;
  name: string;
  status: string;
  documentRoot: string;
  appType?: AppType;
  startCommand?: string | null;
  appWorkingDir?: string | null;
  upstreamPort?: number | null;
  appStatus?: string | null;
  appEnv?: string | null;
  lastError?: string | null;
  server: { name: string; hostname: string };
  user?: { id: string; name: string; email: string };
  sslCerts: Array<{
    id: string;
    status: string;
    expiresAt: string | null;
    lastError?: string | null;
  }>;
};

type ServerOption = { id: string; name: string; hostname: string };

function StatusBadge({ status, error }: { status: string; error?: string | null }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    PENDING: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    ERROR: "bg-red-500/15 text-red-300 ring-red-500/30",
    SUSPENDED: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  };

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles[status] ?? styles.SUSPENDED}`}
      >
        {status}
      </span>
      {status === "ERROR" && error && (
        <span className="flex max-w-xs items-start gap-1 text-xs text-red-400/80">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </span>
      )}
    </div>
  );
}

export default function DomainsPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [name, setName] = useState("");
  const [serverId, setServerId] = useState("");
  const [appType, setAppType] = useState<AppType>("STATIC");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [sslLoading, setSslLoading] = useState<string | null>(null);
  const [sslError, setSslError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [runtimeDomain, setRuntimeDomain] = useState<Domain | null>(null);

  async function load() {
    const [domainsRes, serversRes] = await Promise.all([
      fetch("/api/domains"),
      fetch("/api/domains", { method: "OPTIONS" }),
    ]);
    const domainsData = await domainsRes.json();
    const serversData = await serversRes.json();
    setDomains(domainsData.domains ?? []);
    setIsAdmin(domainsData.role === "ADMIN");
    setServers(serversData.servers ?? []);
    if (serversData.servers?.[0]) setServerId(serversData.servers[0].id);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, serverId, appType }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to create domain");
      return;
    }
    if (data.domain?.status === "ERROR") {
      setError(data.domain.lastError ?? "Agent failed — is the app launcher running?");
      return;
    }
    setName("");
    setAppType("STATIC");
    setCreateOpen(false);
    await load();
    router.refresh();
  }

  async function handleRetry(id: string) {
    setRetrying(id);
    const res = await fetch(`/api/domains?id=${id}`, { method: "PATCH" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Retry failed");
    }
    setRetrying(null);
    await load();
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this domain?")) return;
    await fetch(`/api/domains?id=${id}`, { method: "DELETE" });
    await load();
    router.refresh();
  }

  async function handleIssueSsl(domainId: string) {
    setSslError("");
    setSslLoading(domainId);
    const res = await fetch("/api/ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId, includeWww: true, autoRenew: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSslError(data.error ?? "Failed to issue SSL");
    } else if (data.certificate?.status === "FAILED") {
      setSslError(data.certificate.lastError ?? "SSL issuance failed");
    }
    setSslLoading(null);
    await load();
  }

  async function handleRenewSsl(certId: string, domainId: string) {
    setSslError("");
    setSslLoading(domainId);
    await fetch(`/api/ssl?id=${certId}`, { method: "PATCH" });
    setSslLoading(null);
    await load();
  }

  if (loading) return <p className="text-slate-400">Loading...</p>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Domains"
        description="Add and manage hosted domains (React, PHP, Python, Go)."
        actionLabel="Add Domain"
        onAction={() => setCreateOpen(true)}
        actionIcon={<Globe className="h-4 w-4" />}
      />

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setError("");
        }}
        title="Add Domain"
        description="Register a new domain on your hosting server."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Domain name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="example.com"
              className={modalInputClass}
              required
            />
          </div>
          <div>
            <label className={modalLabelClass}>Server</label>
            <Select
              value={serverId}
              onChange={setServerId}
              options={servers.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.hostname})`,
              }))}
              placeholder="Choose server..."
            />
          </div>
          <AppTypeSelectField value={appType} onChange={setAppType} />
          {error && (
            <p className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
          <ModalActions onCancel={() => setCreateOpen(false)} submitLabel="Add Domain" />
        </form>
      </Modal>

      <Modal
        open={Boolean(runtimeDomain)}
        onClose={() => setRuntimeDomain(null)}
        title={runtimeDomain ? `App runtime — ${runtimeDomain.name}` : "App runtime"}
        description="Choose how this site is served and manage Python/Go processes."
      >
        {runtimeDomain ? (
          <AppRuntimeControls
            kind="domain"
            id={runtimeDomain.id}
            appType={runtimeDomain.appType ?? "PHP"}
            startCommand={runtimeDomain.startCommand}
            appWorkingDir={runtimeDomain.appWorkingDir}
            upstreamPort={runtimeDomain.upstreamPort}
            appStatus={runtimeDomain.appStatus}
            appEnv={runtimeDomain.appEnv}
            onUpdated={async () => {
              await load();
            }}
          />
        ) : null}
      </Modal>

      {sslError && (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {sslError}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-5 py-3.5 font-medium">Domain</th>
              {isAdmin ? (
                <th className="px-5 py-3.5 font-medium">Owner</th>
              ) : null}
              <th className="px-5 py-3.5 font-medium">App</th>
              <th className="px-5 py-3.5 font-medium">Status</th>
              <th className="px-5 py-3.5 font-medium">Document Root</th>
              <th className="px-5 py-3.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => {
              const ssl = d.sslCerts[0];
              return (
                <tr key={d.id} className="border-t border-slate-800/80 hover:bg-slate-900/30">
                  <td className="px-5 py-4 font-medium text-white">
                    <a
                      href={`https://${d.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-emerald-400 hover:underline"
                      title={`Open https://${d.name}`}
                    >
                      {d.name}
                    </a>
                  </td>
                  {isAdmin ? (
                    <td className="px-5 py-4 text-xs text-slate-400">
                      <p className="truncate text-slate-300">
                        {d.user?.name ?? "—"}
                      </p>
                      <p className="truncate">{d.user?.email ?? ""}</p>
                    </td>
                  ) : null}
                  <td className="px-5 py-4 text-slate-300">
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs">
                      {d.appType ?? "PHP"}
                    </span>
                    {d.upstreamPort ? (
                      <span className="ml-2 font-mono text-xs text-slate-500">
                        :{d.upstreamPort}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={d.status} error={d.lastError} />
                  </td>
                  <td className="max-w-xs truncate px-5 py-4 font-mono text-xs text-slate-400">
                    {d.documentRoot}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRuntimeDomain(d)}
                        className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 px-3 py-1.5 text-xs text-sky-400 hover:bg-sky-500/10"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        Runtime
                      </button>
                      {ssl?.status === "ACTIVE" ? (
                        <button
                          type="button"
                          onClick={() => handleRenewSsl(ssl.id, d.id)}
                          disabled={sslLoading === d.id}
                          className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${sslLoading === d.id ? "animate-spin" : ""}`}
                          />
                          Renew SSL
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleIssueSsl(d.id)}
                          disabled={sslLoading === d.id || d.status !== "ACTIVE"}
                          className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          {ssl ? "Re-issue SSL" : "Issue SSL"}
                        </button>
                      )}
                      <a
                        href={`/file-manager?target=d:${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-emerald-400 hover:bg-slate-800"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        Open files
                      </a>
                      {d.status === "ERROR" && (
                        <button
                          type="button"
                          onClick={() => handleRetry(d.id)}
                          disabled={retrying === d.id}
                          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${retrying === d.id ? "animate-spin" : ""}`}
                          />
                          Retry
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(d.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {domains.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                  No domains yet. Click Add Domain to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
