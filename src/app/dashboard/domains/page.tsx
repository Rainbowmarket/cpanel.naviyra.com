"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Globe, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";

type Domain = {
  id: string;
  name: string;
  status: string;
  documentRoot: string;
  lastError?: string | null;
  server: { name: string; hostname: string };
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
  const [name, setName] = useState("");
  const [serverId, setServerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    const [domainsRes, serversRes] = await Promise.all([
      fetch("/api/domains"),
      fetch("/api/domains", { method: "OPTIONS" }),
    ]);
    const domainsData = await domainsRes.json();
    const serversData = await serversRes.json();
    setDomains(domainsData.domains ?? []);
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
      body: JSON.stringify({ name, serverId }),
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

  if (loading) return <p className="text-slate-400">Loading...</p>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Domains"
        description="Add and manage hosted domains."
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
            <p className="mt-2 text-xs text-slate-500">
              Picks which machine will host the domain. With one server, keep Primary
              Server selected.
            </p>
          </div>
          {error && (
            <p className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
          <ModalActions onCancel={() => setCreateOpen(false)} submitLabel="Add Domain" />
        </form>
      </Modal>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-5 py-3.5 font-medium">Domain</th>
              <th className="px-5 py-3.5 font-medium">Server</th>
              <th className="px-5 py-3.5 font-medium">Status</th>
              <th className="px-5 py-3.5 font-medium">Document Root</th>
              <th className="px-5 py-3.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id} className="border-t border-slate-800/80 hover:bg-slate-900/30">
                <td className="px-5 py-4 font-medium text-white">{d.name}</td>
                <td className="px-5 py-4 text-slate-300">{d.server.hostname}</td>
                <td className="px-5 py-4">
                  <StatusBadge status={d.status} error={d.lastError} />
                </td>
                <td className="max-w-xs truncate px-5 py-4 font-mono text-xs text-slate-400">
                  {d.documentRoot}
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {d.status === "ERROR" && (
                      <button
                        onClick={() => handleRetry(d.id)}
                        disabled={retrying === d.id}
                        className="flex items-center gap-1 text-sm text-amber-400 hover:text-amber-300 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${retrying === d.id ? "animate-spin" : ""}`} />
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(d.id)}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
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
