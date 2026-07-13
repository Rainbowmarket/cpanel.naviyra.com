"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatDate, matchesSearch } from "@/lib/utils";
import { AlertCircle, Mail, Network, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";

type DnsRecord = {
  id: string;
  name: string;
  type: string;
  value: string;
  ttl: number;
  priority: number | null;
};

type DnsZone = {
  id: string;
  serial: number;
  syncedAt: string | null;
  lastError: string | null;
  domain: { id: string; name: string; status: string; server: { ipAddress: string } };
  records: DnsRecord[];
};

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT"];

function recordLabel(name: string, domain: string) {
  if (name === "@" || name === "") return domain;
  return `${name}.${domain}`;
}

export default function DnsPage() {
  const [zones, setZones] = useState<DnsZone[]>([]);
  const [nameservers, setNameservers] = useState({ ns1: "", ns2: "" });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [activeZone, setActiveZone] = useState<DnsZone | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [recordName, setRecordName] = useState("@");
  const [recordType, setRecordType] = useState("A");
  const [recordValue, setRecordValue] = useState("");
  const [recordTtl, setRecordTtl] = useState("86400");
  const [recordPriority, setRecordPriority] = useState("10");
  const [formError, setFormError] = useState("");

  async function loadZones() {
    const res = await fetch("/api/dns");
    const data = await res.json();
    setZones(data.zones ?? []);
    if (data.nameservers) setNameservers(data.nameservers);
  }

  useEffect(() => {
    loadZones();
  }, []);

  function closeModal() {
    setModalOpen(false);
    setActiveZone(null);
    setEditingRecordId(null);
    setFormError("");
  }

  function openAddRecord(zone: DnsZone) {
    setModalMode("add");
    setActiveZone(zone);
    setEditingRecordId(null);
    setRecordName("@");
    setRecordType("A");
    setRecordValue(zone.domain.server.ipAddress);
    setRecordTtl("86400");
    setRecordPriority("10");
    setFormError("");
    setModalOpen(true);
  }

  function openEditRecord(zone: DnsZone, record: DnsRecord) {
    setModalMode("edit");
    setActiveZone(zone);
    setEditingRecordId(record.id);
    setRecordName(record.name);
    setRecordType(record.type);
    setRecordValue(record.value);
    setRecordTtl(String(record.ttl));
    setRecordPriority(String(record.priority ?? 10));
    setFormError("");
    setModalOpen(true);
  }

  async function handleRetry(domainId: string) {
    setLoading(true);
    await fetch(`/api/dns?domainId=${domainId}`, { method: "PATCH" });
    await loadZones();
    setLoading(false);
  }

  async function handleAddMailRecords(domainId: string) {
    setLoading(true);
    await fetch("/api/dns/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mail", domainId }),
    });
    await loadZones();
    setLoading(false);
  }

  async function handleDeleteRecord(recordId: string) {
    if (!confirm("Delete this DNS record?")) return;
    setLoading(true);
    await fetch(`/api/dns/records?id=${recordId}`, { method: "DELETE" });
    await loadZones();
    setLoading(false);
  }

  async function handleSaveRecord(e: FormEvent) {
    e.preventDefault();
    if (!activeZone) return;

    setFormError("");
    setLoading(true);

    const payload = {
      name: recordName,
      type: recordType,
      value: recordValue,
      ttl: Number(recordTtl),
      ...(recordType === "MX" ? { priority: Number(recordPriority) } : {}),
    };

    const res =
      modalMode === "edit" && editingRecordId
        ? await fetch(`/api/dns/records?id=${editingRecordId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/dns/records", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domainId: activeZone.domain.id, ...payload }),
          });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setFormError(typeof data.error === "string" ? data.error : "Failed to save record");
      return;
    }

    closeModal();
    await loadZones();
  }

  const filtered = zones.filter((zone) =>
    matchesSearch(
      search,
      zone.domain.name,
      zone.domain.server.ipAddress,
      ...zone.records.map((r) => `${r.name} ${r.type} ${r.value}`)
    )
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="DNS Zones"
        description="Manage DNS records for your domains."
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search zones or records..."
      />

      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-5">
        <div className="flex items-start gap-3">
          <Network className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <p className="text-sm text-slate-400">
            Nameservers:{" "}
            <span className="text-emerald-300">{nameservers.ns1}</span>
            {" · "}
            <span className="text-emerald-300">{nameservers.ns2}</span>
          </p>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={`${modalMode === "edit" ? "Edit" : "Add"} DNS Record${
          activeZone ? ` — ${activeZone.domain.name}` : ""
        }`}
        description="Use @ for the root domain, or a label like www, mail, or blog."
      >
        <form onSubmit={handleSaveRecord} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Name</label>
            <input
              value={recordName}
              onChange={(e) => setRecordName(e.target.value)}
              placeholder="@ or subdomain label"
              className={modalInputClass}
              required
            />
          </div>
          <div>
            <label className={modalLabelClass}>Type</label>
            <Select
              value={recordType}
              onChange={setRecordType}
              options={RECORD_TYPES.map((type) => ({ value: type, label: type }))}
            />
          </div>
          <div>
            <label className={modalLabelClass}>Value</label>
            <input
              value={recordValue}
              onChange={(e) => setRecordValue(e.target.value)}
              placeholder={recordType === "TXT" ? "v=spf1 ..." : "203.0.113.10 or hostname"}
              className={modalInputClass}
              required
            />
          </div>
          {recordType === "MX" && (
            <div>
              <label className={modalLabelClass}>Priority</label>
              <input
                type="number"
                value={recordPriority}
                onChange={(e) => setRecordPriority(e.target.value)}
                className={modalInputClass}
                min={0}
                required
              />
            </div>
          )}
          <div>
            <label className={modalLabelClass}>TTL (seconds)</label>
            <input
              type="number"
              value={recordTtl}
              onChange={(e) => setRecordTtl(e.target.value)}
              className={modalInputClass}
              min={60}
              required
            />
          </div>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <ModalActions
            onCancel={closeModal}
            submitLabel={modalMode === "edit" ? "Save Changes" : "Add Record"}
            submitting={loading}
          />
        </form>
      </Modal>

      <div className="space-y-4">
        {filtered.map((zone) => (
          <div
            key={zone.id}
            className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
              <div>
                <p className="font-semibold text-white">{zone.domain.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Serial {zone.serial}
                  {zone.syncedAt && ` · Synced ${formatDate(zone.syncedAt)}`}
                  {zone.lastError && (
                    <span className="ml-2 inline-flex items-center gap-1 text-red-400">
                      <AlertCircle className="h-3 w-3" />
                      {zone.lastError}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openAddRecord(zone)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add record
                </button>
                <button
                  type="button"
                  onClick={() => handleAddMailRecords(zone.domain.id)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Add mail records
                </button>
                <button
                  type="button"
                  onClick={() => handleRetry(zone.domain.id)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  Re-sync
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Value</th>
                    <th className="px-5 py-3 font-medium">TTL</th>
                    <th className="px-5 py-3 font-medium">Pri</th>
                    <th className="px-5 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {zone.records.map((record) => (
                    <tr key={record.id} className="border-b border-slate-800/50 last:border-0">
                      <td className="px-5 py-3 font-mono text-emerald-300/90">
                        {recordLabel(record.name, zone.domain.name)}
                      </td>
                      <td className="px-5 py-3 text-slate-300">{record.type}</td>
                      <td className="max-w-xs truncate px-5 py-3 font-mono text-slate-400">
                        {record.value}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{record.ttl}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {record.priority ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditRecord(zone, record)}
                            disabled={loading}
                            className="rounded p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-emerald-400 disabled:opacity-50"
                            title="Edit record"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecord(record.id)}
                            disabled={loading}
                            className="rounded p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                            title="Delete record"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-slate-500">
            {zones.length === 0
              ? "No DNS zones yet. Add a domain to auto-create a zone."
              : "No zones match your search."}
          </div>
        )}
      </div>
    </div>
  );
}
