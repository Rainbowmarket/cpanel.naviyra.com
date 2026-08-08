"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  FolderOpen,
  Lock,
  Mail,
  Pencil,
  RefreshCw,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { matchesSearch } from "@/lib/utils";
import {
  AppRuntimeControls,
  AppTypeSelectField,
  type AppType,
} from "@/components/apps/AppRuntimeControls";

type Domain = { id: string; name: string };
type Subdomain = {
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
  domain: { name: string };
  sslCerts: Array<{
    id: string;
    status: string;
    expiresAt: string | null;
    lastError?: string | null;
  }>;
};

/** mail.* / webmail.* hosts proxy to panel webmail — not normal websites. */
function isMailHostSubdomain(s: Subdomain): boolean {
  const label = s.name.split(".")[0]?.toLowerCase() ?? "";
  return label === "mail" || label === "webmail";
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    PENDING: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    ERROR: "bg-red-500/15 text-red-300 ring-red-500/30",
    SUSPENDED: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  };
  return (
    <span
      className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${styles[status] ?? styles.SUSPENDED}`}
    >
      {status}
    </span>
  );
}

export default function SubdomainsPage() {
  const { confirm } = useAlert();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [panelBaseDomain, setPanelBaseDomain] = useState<string | null>(null);
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
  const [createMode, setCreateMode] = useState<"standard" | "custom">("standard");
  const [customFqdn, setCustomFqdn] = useState("");
  const [appType, setAppType] = useState<AppType>("STATIC");
  const [runtimeSub, setRuntimeSub] = useState<Subdomain | null>(null);

  const parentDomain = domains.find((d) => d.id === domainId)?.name;

  function resolveCreatePayload():
    | {
        domainId?: string;
        name?: string;
        fqdn?: string;
        documentRoot?: string;
        appType: AppType;
      }
    | { error: string } {
    if (createMode === "custom") {
      const fqdn =
        customFqdn.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ??
        "";
      if (!fqdn.includes(".")) {
        return { error: "Enter a full hostname like blog.example.com" };
      }
      return {
        fqdn,
        documentRoot: useCustomDir && customDir ? customDir : undefined,
        appType,
      };
    }
    if (!domainId || !name.trim()) {
      return { error: "Domain and subdomain name are required" };
    }
    return {
      domainId,
      name: name.trim(),
      documentRoot: useCustomDir && customDir ? customDir : undefined,
      appType,
    };
  }

  async function loadDomains() {
    const res = await fetch("/api/domains");
    const data = await res.json();
    const list = data.domains ?? [];
    setDomains(list);
    setPanelBaseDomain(
      typeof data.panelBaseDomain === "string" ? data.panelBaseDomain : null
    );
    if (list[0] && !domainId) setDomainId(list[0].id);
  }

  async function loadAllSubdomains() {
    const res = await fetch("/api/subdomains");
    const data = await res.json();
    setSubdomains(data.subdomains ?? []);
  }

  useEffect(() => {
    loadDomains();
    loadAllSubdomains();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    const payload = resolveCreatePayload();
    if ("error" in payload) {
      setError(payload.error);
      return;
    }
    const res = await fetch("/api/subdomains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(
        typeof data.error === "string"
          ? data.error
          : "Failed to create subdomain"
      );
      return;
    }
    setName("");
    setCustomFqdn("");
    setCustomDir("");
    setUseCustomDir(false);
    setCreateMode("standard");
    setAppType("STATIC");
    setCreateOpen(false);
    await loadDomains();
    loadAllSubdomains();
  }

  async function handleRetry(id: string) {
    setRetrying(id);
    await fetch(`/api/subdomains?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setRetrying(null);
    loadAllSubdomains();
  }

  async function handleDelete(id: string, documentRoot: string) {
    const ok = await confirm("Delete this subdomain from the panel?", {
      title: "Delete subdomain",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;

    const deleteFiles = await confirm(
      `Also delete the folder and all files?\n\n${documentRoot}\n\nYes = delete folder\nNo = keep folder on disk`,
      {
        title: "Delete files?",
        danger: true,
        confirmLabel: "Delete folder",
        cancelLabel: "Keep folder",
      }
    );

    await fetch(
      `/api/subdomains?id=${id}&deleteFiles=${deleteFiles ? "true" : "false"}`,
      { method: "DELETE" }
    );
    loadAllSubdomains();
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
    loadAllSubdomains();
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
    loadAllSubdomains();
  }

  async function handleRenewSsl(certId: string, subdomainId: string) {
    setSslError("");
    setSslLoading(subdomainId);
    await fetch(`/api/ssl?id=${certId}`, { method: "PATCH" });
    setSslLoading(null);
    loadAllSubdomains();
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
    <div className="space-y-4">
      <PageHeader
        title="Subdomains"
        description="Create and manage subdomains across all of your domains."
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
        description="Create a standard or custom subdomain under your domains."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-1">
            <button
              type="button"
              onClick={() => setCreateMode("standard")}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                createMode === "standard"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Standard
            </button>
            <button
              type="button"
              onClick={() => setCreateMode("custom")}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${
                createMode === "custom"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Custom subdomain
            </button>
          </div>

          {createMode === "standard" ? (
            <>
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
                  required={createMode === "standard"}
                />
                {parentDomain && name.trim() ? (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Will create{" "}
                    <span className="font-mono text-emerald-400/90">
                      {name.trim().toLowerCase()}.{parentDomain}
                    </span>
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <div>
              <label className={modalLabelClass}>Full hostname</label>
              <input
                value={customFqdn}
                onChange={(e) => setCustomFqdn(e.target.value)}
                placeholder="api.shop.example.com"
                className={modalInputClass}
                required={createMode === "custom"}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Enter the full address. Parent domain is detected automatically.
                Nested labels work (e.g.{" "}
                <span className="font-mono">api.v1.example.com</span>).
                {panelBaseDomain ? (
                  <>
                    {" "}
                    Panel domain works too (e.g.{" "}
                    <span className="font-mono">block.{panelBaseDomain}</span>).
                  </>
                ) : null}
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={useCustomDir}
              onChange={(e) => setUseCustomDir(e.target.checked)}
              className="rounded border-slate-600"
            />
            Use custom document root
          </label>
          {useCustomDir && (
            <input
              value={customDir}
              onChange={(e) => setCustomDir(e.target.value)}
              placeholder="/var/www/example.com/subdomains/blog/public_html"
              className={`${modalInputClass} font-mono text-sm`}
            />
          )}
          <AppTypeSelectField value={appType} onChange={setAppType} />
          {!useCustomDir ? (
            <p className="text-xs text-slate-500">
              Default folder:{" "}
              <span className="font-mono text-slate-400">
                /var/www/{"{domain}"}/subdomains/{"{name}"}/public_html
              </span>
            </p>
          ) : null}
          {error && (
            <p className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}
          <ModalActions onCancel={() => setCreateOpen(false)} submitLabel="Add Subdomain" />
        </form>
      </Modal>

      <Modal
        open={Boolean(runtimeSub)}
        onClose={() => setRuntimeSub(null)}
        title={
          runtimeSub
            ? `App runtime — ${runtimeSub.name}.${runtimeSub.domain.name}`
            : "App runtime"
        }
        description="Choose how this subdomain is served and manage Node/Python/Go processes."
      >
        {runtimeSub ? (
          <AppRuntimeControls
            kind="subdomain"
            id={runtimeSub.id}
            applicationUrl={`https://${runtimeSub.name}.${runtimeSub.domain.name}`}
            appType={runtimeSub.appType ?? "PHP"}
            startCommand={runtimeSub.startCommand}
            appStartupFile={runtimeSub.appStartupFile}
            appWorkingDir={runtimeSub.appWorkingDir}
            upstreamPort={runtimeSub.upstreamPort}
            appStatus={runtimeSub.appStatus}
            appEnv={runtimeSub.appEnv}
            onUpdated={() => loadAllSubdomains()}
          />
        ) : null}
      </Modal>

      {sslError && (
        <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          {sslError}
        </p>
      )}

      <div className="space-y-2">
        {filteredSubdomains.map((s) => {
          const ssl = s.sslCerts[0];
          const fqdn = `${s.name}.${s.domain.name}`;
          const mailHost = isMailHostSubdomain(s);
          const btn =
            "inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-50";

          return (
            <div
              key={s.id}
              className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 sm:p-4"
            >
              <a
                href={mailHost ? `https://${fqdn}/webmail` : `https://${fqdn}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium text-white hover:text-emerald-400"
                title={fqdn}
              >
                {fqdn}
              </a>

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <StatusBadge status={s.status} />
                {mailHost ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                    <Mail className="h-3 w-3" />
                    Webmail
                  </span>
                ) : (
                  <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {s.appType ?? "PHP"}
                  </span>
                )}
                {ssl ? (
                  <span
                    className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${sslStatusColor(ssl.status)}`}
                  >
                    SSL {ssl.status}
                  </span>
                ) : (
                  <span className="inline-flex rounded-md bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-slate-500/30">
                    No SSL
                  </span>
                )}
              </div>

              {mailHost ? (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Proxies to panel webmail — not a website root.
                </p>
              ) : editingId === s.id ? (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={editPath}
                    onChange={(e) => setEditPath(e.target.value)}
                    className="min-w-0 w-full flex-1 rounded-lg border border-emerald-500/40 bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-white outline-none focus:ring-1 focus:ring-emerald-500/30"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => saveEditPath(s.id)}
                      disabled={savingPath === s.id}
                      className={`${btn} border-emerald-500/40 bg-emerald-500/15 text-emerald-300`}
                    >
                      {savingPath === s.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditPath}
                      className={`${btn} border-slate-700 text-slate-300`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className="mt-1.5 truncate font-mono text-[11px] text-slate-500"
                  title={s.documentRoot}
                >
                  {s.documentRoot}
                </p>
              )}

              {s.lastError ? (
                <p className="mt-1 text-[11px] text-red-400">{s.lastError}</p>
              ) : null}
              {ssl?.lastError ? (
                <p className="mt-1 text-[11px] text-red-400">
                  SSL: {ssl.lastError}
                </p>
              ) : null}

              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:mt-3 sm:flex sm:flex-wrap sm:justify-end">
                {mailHost ? (
                  <>
                    <a
                      href={`https://${fqdn}/webmail`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${btn} border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10`}
                    >
                      <Mail className="h-3 w-3" />
                      Webmail
                    </a>
                    {ssl?.status === "ACTIVE" ? (
                      <button
                        type="button"
                        onClick={() => handleRenewSsl(ssl.id, s.id)}
                        disabled={sslLoading === s.id}
                        className={`${btn} border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10`}
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${sslLoading === s.id ? "animate-spin" : ""}`}
                        />
                        Renew SSL
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleIssueSsl(s.id)}
                        disabled={sslLoading === s.id || s.status !== "ACTIVE"}
                        className={`${btn} border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10`}
                      >
                        <Lock className="h-3 w-3" />
                        {ssl ? "Re-issue SSL" : "Issue SSL"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id, s.documentRoot)}
                      className={`${btn} col-span-2 border-red-500/30 text-red-400 hover:bg-red-500/10 sm:col-span-1`}
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setRuntimeSub(s)}
                      className={`${btn} border-sky-500/30 text-sky-400 hover:bg-sky-500/10`}
                    >
                      <Settings2 className="h-3 w-3" />
                      Runtime
                    </button>
                    {ssl?.status === "ACTIVE" ? (
                      <button
                        type="button"
                        onClick={() => handleRenewSsl(ssl.id, s.id)}
                        disabled={sslLoading === s.id}
                        className={`${btn} border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10`}
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${sslLoading === s.id ? "animate-spin" : ""}`}
                        />
                        Renew SSL
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleIssueSsl(s.id)}
                        disabled={sslLoading === s.id || s.status !== "ACTIVE"}
                        className={`${btn} border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10`}
                        title={
                          s.status !== "ACTIVE"
                            ? "Subdomain must be active before issuing SSL"
                            : undefined
                        }
                      >
                        <Lock className="h-3 w-3" />
                        {ssl ? "Re-issue SSL" : "Issue SSL"}
                      </button>
                    )}
                    {editingId !== s.id ? (
                      <button
                        type="button"
                        onClick={() => startEditPath(s)}
                        className={`${btn} border-slate-700 text-slate-300 hover:bg-slate-800`}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit path
                      </button>
                    ) : null}
                    <a
                      href={`/file-manager?target=s:${s.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${btn} border-slate-700 text-emerald-400 hover:bg-slate-800`}
                    >
                      <FolderOpen className="h-3 w-3" />
                      Files
                    </a>
                    {s.status === "ERROR" ? (
                      <button
                        type="button"
                        onClick={() => handleRetry(s.id)}
                        disabled={retrying === s.id}
                        className={`${btn} border-amber-500/30 text-amber-400 hover:bg-amber-500/10`}
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${retrying === s.id ? "animate-spin" : ""}`}
                        />
                        Retry
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id, s.documentRoot)}
                      className={`${btn} border-red-500/30 text-red-400 hover:bg-red-500/10`}
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {subdomains.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-sm text-slate-500">
            No subdomains yet.
          </p>
        ) : filteredSubdomains.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-sm text-slate-500">
            No subdomains match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
