"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  FolderOpen,
  Globe,
  Lock,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
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
  appStartupFile?: string | null;
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

function apiErrorText(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const rec = error as {
      message?: unknown;
      formErrors?: unknown;
      fieldErrors?: Record<string, unknown>;
    };
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
    if (Array.isArray(rec.formErrors) && typeof rec.formErrors[0] === "string") {
      return rec.formErrors[0];
    }
    const field = rec.fieldErrors
      ? Object.values(rec.fieldErrors).flat()[0]
      : undefined;
    if (typeof field === "string") return field;
  }
  return fallback;
}

function hasDomainExtension(value: string): boolean {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.split(":")[0]
    ?.replace(/\.$/, "")
    ?.replace(/^www\./, "");
  return Boolean(host && host.includes(".") && /\.[a-z0-9-]{2,}$/i.test(host));
}

function StatusBadge({ status, error }: { status: string; error?: string | null }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    PENDING: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    ERROR: "bg-red-500/15 text-red-300 ring-red-500/30",
    SUSPENDED: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  };

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={`inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${styles[status] ?? styles.SUSPENDED}`}
      >
        {status}
      </span>
      {status === "ERROR" && error ? (
        <span className="max-w-[14rem] truncate text-[10px] text-red-400/80" title={error}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

export default function DomainsPage() {
  const router = useRouter();
  const { confirm } = useAlert();
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
    if (!hasDomainExtension(name)) {
      setError(
        "Enter a full domain with an extension like .com, .uk, or .in (e.g. example.com)"
      );
      return;
    }
    const res = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, serverId, appType }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(apiErrorText(data.error, "Failed to create domain"));
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
      setError(apiErrorText(data.error, "Retry failed"));
    }
    setRetrying(null);
    await load();
    router.refresh();
  }

  async function handleDelete(id: string) {
    const ok = await confirm("Delete this domain? This cannot be undone.", {
      title: "Delete domain",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
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
    <div className="space-y-4">
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
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              placeholder="example.com"
              className={modalInputClass}
              required
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              title="Use a full domain with an extension, e.g. example.com"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Include the extension (.com, .uk, .in, …). A name like{" "}
              <span className="font-mono">mysite</span> is not a domain.
            </p>
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
        description="Choose how this site is served and manage Node/Python/Go processes."
      >
        {runtimeDomain ? (
          <AppRuntimeControls
            kind="domain"
            id={runtimeDomain.id}
            applicationUrl={`https://${runtimeDomain.name}`}
            appType={runtimeDomain.appType ?? "PHP"}
            startCommand={runtimeDomain.startCommand}
            appStartupFile={runtimeDomain.appStartupFile}
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

      {sslError ? (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {sslError}
        </p>
      ) : null}

      <div className="space-y-2">
        {domains.map((d) => {
          const ssl = d.sslCerts[0];
          const btn =
            "inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-50";
          return (
            <div
              key={d.id}
              className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 sm:p-4"
            >
              <a
                href={`https://${d.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium text-white hover:text-emerald-400"
                title={d.name}
              >
                {d.name}
              </a>

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <StatusBadge status={d.status} error={d.lastError} />
                <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {d.appType ?? "PHP"}
                  {d.upstreamPort ? ` :${d.upstreamPort}` : ""}
                </span>
                {ssl ? (
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                      ssl.status === "ACTIVE"
                        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                        : ssl.status === "FAILED"
                          ? "bg-red-500/15 text-red-300 ring-red-500/30"
                          : "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                    }`}
                  >
                    SSL {ssl.status}
                  </span>
                ) : (
                  <span className="rounded-md bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-slate-400 ring-1 ring-slate-500/30">
                    No SSL
                  </span>
                )}
                {isAdmin && d.user?.email ? (
                  <span
                    className="max-w-[12rem] truncate rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400"
                    title={d.user.email}
                  >
                    {d.user.name || d.user.email}
                  </span>
                ) : null}
              </div>

              <p
                className="mt-1.5 truncate font-mono text-[11px] text-slate-500"
                title={d.documentRoot}
              >
                {d.documentRoot}
              </p>

              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
                <button
                  type="button"
                  onClick={() => setRuntimeDomain(d)}
                  className={`${btn} border-sky-500/30 text-sky-400 hover:bg-sky-500/10`}
                >
                  <Settings2 className="h-3 w-3" />
                  Runtime
                </button>
                {ssl?.status === "ACTIVE" ? (
                  <button
                    type="button"
                    onClick={() => handleRenewSsl(ssl.id, d.id)}
                    disabled={sslLoading === d.id}
                    className={`${btn} border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10`}
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${sslLoading === d.id ? "animate-spin" : ""}`}
                    />
                    Renew SSL
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleIssueSsl(d.id)}
                    disabled={sslLoading === d.id || d.status !== "ACTIVE"}
                    className={`${btn} border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10`}
                  >
                    <Lock className="h-3 w-3" />
                    {ssl ? "Re-issue SSL" : "Issue SSL"}
                  </button>
                )}
                <a
                  href={`/file-manager?target=d:${d.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${btn} border-slate-700 text-emerald-400 hover:bg-slate-800`}
                >
                  <FolderOpen className="h-3 w-3" />
                  Files
                </a>
                {d.status === "ERROR" ? (
                  <button
                    type="button"
                    onClick={() => handleRetry(d.id)}
                    disabled={retrying === d.id}
                    className={`${btn} border-amber-500/30 text-amber-400 hover:bg-amber-500/10`}
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${retrying === d.id ? "animate-spin" : ""}`}
                    />
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  className={`${btn} border-red-500/30 text-red-400 hover:bg-red-500/10`}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {domains.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800 px-5 py-10 text-center text-sm text-slate-500">
            No domains yet. Click Add Domain to create one.
          </p>
        ) : null}
      </div>
    </div>
  );
}
