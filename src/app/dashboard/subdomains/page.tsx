"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  FolderOpen,
  Lock,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { matchesSearch } from "@/lib/utils";

type Domain = { id: string; name: string };
type Subdomain = {
  id: string;
  name: string;
  status: string;
  documentRoot: string;
  lastError?: string | null;
  domain: { name: string };
  sslCerts: Array<{
    id: string;
    status: string;
    expiresAt: string | null;
    lastError?: string | null;
  }>;
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    PENDING: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    ERROR: "bg-red-500/15 text-red-300 ring-red-500/30",
    SUSPENDED: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles[status] ?? styles.SUSPENDED}`}
    >
      {status}
    </span>
  );
}

export default function SubdomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [subdomains, setSubdomains] = useState<Subdomain[]>([]);
  const [domainId, setDomainId] = useState("");
  const [name, setName] = useState("");
  const [customDir, setCustomDir] = useState("");
  const [useCustomDir, setUseCustomDir] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPath, setEditPath] = useState("");
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [sslLoading, setSslLoading] = useState<string | null>(null);
  const [sslError, setSslError] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  async function loadDomains() {
    const res = await fetch("/api/domains");
    const data = await res.json();
    const list = data.domains ?? [];
    setDomains(list);
    if (list[0] && !domainId) setDomainId(list[0].id);
  }

  async function loadSubdomains(id: string) {
    const res = await fetch(`/api/subdomains?domainId=${id}`);
    const data = await res.json();
    setSubdomains(data.subdomains ?? []);
  }

  useEffect(() => {
    loadDomains();
  }, []);

  useEffect(() => {
    if (domainId) loadSubdomains(domainId);
  }, [domainId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/subdomains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId,
        name,
        documentRoot: useCustomDir && customDir ? customDir : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to create subdomain");
      return;
    }
    setName("");
    setCustomDir("");
    setUseCustomDir(false);
    setCreateOpen(false);
    loadSubdomains(domainId);
  }

  async function handleRetry(id: string) {
    setRetrying(id);
    await fetch(`/api/subdomains?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setRetrying(null);
    loadSubdomains(domainId);
  }

  async function handleDelete(id: string, documentRoot: string) {
    if (!confirm(`Delete subdomain from the panel?`)) return;

    const deleteFiles = confirm(
      `Also delete the folder and all files?\n\n${documentRoot}\n\n• OK = delete folder\n• Cancel = keep folder on disk`
    );

    await fetch(
      `/api/subdomains?id=${id}&deleteFiles=${deleteFiles ? "true" : "false"}`,
      { method: "DELETE" }
    );
    loadSubdomains(domainId);
  }

  function startEditPath(subdomain: Subdomain) {
    setEditingId(subdomain.id);
    setEditPath(subdomain.documentRoot);
  }

  async function saveEditPath(id: string) {
    if (!editPath.trim()) return;
    setSavingPath(id);
    setError("");
    const res = await fetch(`/api/subdomains?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentRoot: editPath.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to update path");
    }
    setSavingPath(null);
    setEditingId(null);
    loadSubdomains(domainId);
  }

  function cancelEditPath() {
    setEditingId(null);
    setEditPath("");
  }

  async function handleIssueSsl(subdomainId: string) {
    setSslError("");
    setSslLoading(subdomainId);
    const res = await fetch("/api/ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomainId, autoRenew: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSslError(data.error ?? "Failed to issue SSL");
    } else if (data.certificate?.status === "FAILED") {
      setSslError(data.certificate.lastError ?? "SSL issuance failed");
    }
    setSslLoading(null);
    loadSubdomains(domainId);
  }

  async function handleRenewSsl(certId: string, subdomainId: string) {
    setSslError("");
    setSslLoading(subdomainId);
    await fetch(`/api/ssl?id=${certId}`, { method: "PATCH" });
    setSslLoading(null);
    loadSubdomains(domainId);
  }

  function sslStatusColor(status: string) {
    switch (status) {
      case "ACTIVE":
        return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
      case "FAILED":
        return "bg-red-500/15 text-red-300 ring-red-500/30";
      case "PENDING":
        return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
      default:
        return "bg-slate-500/15 text-slate-300 ring-slate-500/30";
    }
  }

  const parentDomain = domains.find((d) => d.id === domainId)?.name;

  const filteredSubdomains = subdomains.filter((s) => {
    const fqdn = `${s.name}.${s.domain.name}`;
    const sslStatus = s.sslCerts[0]?.status ?? "No SSL";
    return matchesSearch(
      search,
      fqdn,
      s.name,
      s.domain.name,
      s.status,
      sslStatus,
      s.documentRoot,
      s.lastError,
      s.sslCerts[0]?.lastError
    );
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Subdomains"
        description="Create subdomains under your domains."
        actionLabel="Add Subdomain"
        onAction={() => setCreateOpen(true)}
        actionIcon={<Server className="h-4 w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search subdomains..."
      />

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setError("");
        }}
        title="Add Subdomain"
        description="Create a subdomain under an existing domain."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Domain</label>
            <Select
              value={domainId}
              onChange={setDomainId}
              options={domains.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Choose domain..."
            />
          </div>
          <div>
            <label className={modalLabelClass}>Subdomain name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="blog"
              className={modalInputClass}
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={useCustomDir}
              onChange={(e) => setUseCustomDir(e.target.checked)}
              className="rounded border-slate-600"
            />
            Use custom directory path
          </label>
          {useCustomDir && (
            <input
              value={customDir}
              onChange={(e) => setCustomDir(e.target.value)}
              placeholder="D:\sites\naviyra.uk\blog\public_html"
              className={`${modalInputClass} font-mono text-sm`}
            />
          )}
          <p className="text-xs text-slate-500">
            Default folder:{" "}
            <span className="font-mono text-slate-400">
              sites/{"{domain}"}/subdomains/{"{name}"}/public_html
            </span>
          </p>
          {error && (
            <p className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}
          <ModalActions onCancel={() => setCreateOpen(false)} submitLabel="Add Subdomain" />
        </form>
      </Modal>

      {sslError && (
        <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          {sslError}
        </p>
      )}

      <div className="space-y-3">
        {filteredSubdomains.map((s) => {
          const ssl = s.sslCerts[0];
          const fqdn = `${s.name}.${s.domain.name}`;

          return (
          <div
            key={s.id}
            className="rounded-xl border border-slate-800 bg-slate-950/80 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-white">{fqdn}</p>
                  <StatusBadge status={s.status} />
                  {ssl ? (
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${sslStatusColor(ssl.status)}`}
                    >
                      SSL {ssl.status}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-500/15 px-2.5 py-0.5 text-xs font-medium text-slate-400 ring-1 ring-slate-500/30">
                      No SSL
                    </span>
                  )}
                </div>
                {editingId === s.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={editPath}
                      onChange={(e) => setEditPath(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-emerald-500/40 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:ring-1 focus:ring-emerald-500/30"
                    />
                    <button
                      type="button"
                      onClick={() => saveEditPath(s.id)}
                      disabled={savingPath === s.id}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {savingPath === s.id ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditPath}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 break-all font-mono text-xs text-slate-400">
                    {s.documentRoot}
                  </p>
                )}
                {s.lastError && (
                  <p className="mt-1 text-xs text-red-400">{s.lastError}</p>
                )}
                {ssl?.lastError && (
                  <p className="mt-1 text-xs text-red-400">SSL: {ssl.lastError}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ssl?.status === "ACTIVE" ? (
                  <button
                    type="button"
                    onClick={() => handleRenewSsl(ssl.id, s.id)}
                    disabled={sslLoading === s.id}
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${sslLoading === s.id ? "animate-spin" : ""}`}
                    />
                    Renew SSL
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleIssueSsl(s.id)}
                    disabled={sslLoading === s.id || s.status !== "ACTIVE"}
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                    title={
                      s.status !== "ACTIVE"
                        ? "Subdomain must be active before issuing SSL"
                        : undefined
                    }
                  >
                    <Lock className="h-3.5 w-3.5" />
                    {ssl ? "Re-issue SSL" : "Issue SSL"}
                  </button>
                )}
                {editingId !== s.id && (
                  <button
                    type="button"
                    onClick={() => startEditPath(s)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit path
                  </button>
                )}
                <Link
                  href={`/file-manager?target=s:${s.id}`}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-emerald-400 hover:bg-slate-800"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open files
                </Link>
                {s.status === "ERROR" && (
                  <button
                    type="button"
                    onClick={() => handleRetry(s.id)}
                    disabled={retrying === s.id}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${retrying === s.id ? "animate-spin" : ""}`}
                    />
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(s.id, s.documentRoot)}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
        })}
        {subdomains.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No subdomains for {parentDomain ?? "this domain"} yet.
          </p>
        ) : filteredSubdomains.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No subdomains match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
