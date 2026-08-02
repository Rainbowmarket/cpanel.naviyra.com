"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatDate, matchesSearch } from "@/lib/utils";
import { AlertCircle, Lock, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";

type Domain = { id: string; name: string };
type Subdomain = { id: string; name: string; status: string };
type Certificate = {
  id: string;
  status: string;
  issuedAt: string | null;
  expiresAt: string | null;
  lastError?: string | null;
  domain: { name: string; id: string };
  subdomain?: { name: string; id: string } | null;
};

function getHostname(cert: Certificate) {
  return cert.subdomain
    ? `${cert.subdomain.name}.${cert.domain.name}`
    : cert.domain.name;
}

function statusColor(status: string) {
  switch (status) {
    case "ACTIVE":
      return "text-emerald-400";
    case "FAILED":
      return "text-red-400";
    case "PENDING":
      return "text-amber-400";
    default:
      return "text-slate-400";
  }
}

export default function SslPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState("");
  const [subdomains, setSubdomains] = useState<Subdomain[]>([]);
  const [target, setTarget] = useState("domain");
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const selectedDomain = domains.find((d) => d.id === domainId);

  async function loadCerts() {
    const res = await fetch("/api/ssl");
    const data = await res.json();
    setCertificates(data.certificates ?? []);
  }

  async function loadSubdomains(id: string) {
    const res = await fetch(`/api/subdomains?domainId=${id}`);
    const data = await res.json();
    setSubdomains(data.subdomains ?? []);
    setTarget("domain");
  }

  useEffect(() => {
    fetch("/api/domains")
      .then((r) => r.json())
      .then((d) => {
        setDomains(d.domains ?? []);
        if (d.domains?.[0]) setDomainId(d.domains[0].id);
      });
    loadCerts();
  }, []);

  useEffect(() => {
    if (domainId) loadSubdomains(domainId);
  }, [domainId]);

  const hostOptions = [
    {
      value: "domain",
      label: selectedDomain ? `${selectedDomain.name} (domain)` : "Domain",
    },
    ...subdomains.map((s) => ({
      value: s.id,
      label: `${s.name}.${selectedDomain?.name ?? "domain"} (subdomain)`,
      disabled: s.status !== "ACTIVE",
    })),
  ];

  const existingForSelected =
    target === "domain"
      ? certificates.find((c) => c.domain.id === domainId && !c.subdomain)
      : certificates.find((c) => c.subdomain?.id === target);

  const selectedSubdomain = subdomains.find((s) => s.id === target);
  const canIssue =
    target === "domain" || (selectedSubdomain?.status === "ACTIVE");

  const filteredCertificates = certificates.filter((c) =>
    matchesSearch(
      search,
      getHostname(c),
      c.status,
      c.domain.name,
      c.subdomain?.name,
      c.lastError
    )
  );

  async function handleIssue(e: FormEvent) {
    e.preventDefault();
    if (!canIssue) return;

    setLoading(true);
    setError("");

    const body =
      target === "domain"
        ? { domainId, includeWww: true, autoRenew: true }
        : { subdomainId: target, autoRenew: true };

    const res = await fetch("/api/ssl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to issue SSL");
    } else if (data.certificate?.status === "FAILED") {
      setError(data.certificate.lastError ?? "SSL issuance failed");
    } else {
      setCreateOpen(false);
      setError("");
    }
    setLoading(false);
    loadCerts();
  }

  async function handleRenew(id: string) {
    setLoading(true);
    await fetch(`/api/ssl?id=${id}`, { method: "PATCH" });
    setLoading(false);
    loadCerts();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="SSL Certificates"
        description="Issue and renew Let's Encrypt certificates for domains and subdomains."
        actionLabel={existingForSelected ? "Re-issue SSL" : "Issue SSL"}
        onAction={() => setCreateOpen(true)}
        actionIcon={<Lock className="h-4 w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search certificates..."
      />

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setError("");
        }}
        title={existingForSelected ? "Re-issue SSL" : "Issue SSL Certificate"}
        description="Let's Encrypt certificate for a domain or subdomain."
      >
        <form onSubmit={handleIssue} className="space-y-4">
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
            <label className={modalLabelClass}>Host</label>
            <Select
              value={target}
              onChange={setTarget}
              options={hostOptions}
              placeholder="Choose host..."
              disabled={!domainId}
            />
          </div>

          {target !== "domain" && selectedSubdomain?.status !== "ACTIVE" && (
            <p className="text-sm text-amber-400">
              This subdomain must be active before you can issue SSL.
            </p>
          )}

          {subdomains.length === 0 && domainId && (
            <p className="text-sm text-slate-500">
              No subdomains for this domain. Create one under Subdomains first.
            </p>
          )}

          {error && (
            <p className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}

          <ModalActions
            onCancel={() => setCreateOpen(false)}
            submitLabel={existingForSelected ? "Re-issue SSL" : "Issue SSL"}
            submitting={loading}
            submitDisabled={!domainId || !canIssue}
          />
        </form>
      </Modal>

      <div className="space-y-2">
        {filteredCertificates.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/80 px-5 py-4"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-white">{getHostname(c)}</p>
                {c.subdomain && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                      c.subdomain.name === "mail"
                        ? "bg-purple-500/15 text-purple-300 ring-purple-500/30"
                        : "bg-blue-500/15 text-blue-300 ring-blue-500/30"
                    }`}
                  >
                    {c.subdomain.name === "mail" ? "Mail" : "Subdomain"}
                  </span>
                )}
              </div>
              <p className={`text-sm ${statusColor(c.status)}`}>
                Expires: {formatDate(c.expiresAt)} · {c.status}
              </p>
              {c.lastError && (
                <p className="mt-1 text-xs text-red-400/80">{c.lastError}</p>
              )}
            </div>
            <button
              onClick={() => handleRenew(c.id)}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Renew
            </button>
          </div>
        ))}
        {certificates.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No SSL certificates yet. Click Issue SSL to create one.
          </p>
        ) : filteredCertificates.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No certificates match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
