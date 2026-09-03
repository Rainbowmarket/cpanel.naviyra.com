"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatDate, matchesSearch } from "@/lib/utils";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Mail,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";

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

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT"] as const;
const FILTER_TYPES = ["ALL", ...RECORD_TYPES] as const;
type FilterType = (typeof FILTER_TYPES)[number];

function recordLabel(name: string, domain: string) {
  if (name === "@" || name === "") return domain;
  return `${name}.${domain}`;
}

function typeBadgeClass(type: string) {
  switch (type) {
    case "A":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25";
    case "AAAA":
      return "bg-cyan-500/15 text-cyan-300 ring-cyan-500/25";
    case "CNAME":
      return "bg-amber-500/15 text-amber-300 ring-amber-500/25";
    case "MX":
      return "bg-sky-500/15 text-sky-300 ring-sky-500/25";
    case "TXT":
      return "bg-violet-500/15 text-violet-300 ring-violet-500/25";
    default:
      return "bg-slate-800 text-slate-300 ring-slate-700";
  }
}

export default function DnsPage() {
  const { confirm } = useAlert();
  const [zones, setZones] = useState<DnsZone[]>([]);
  const [nameservers, setNameservers] = useState({ ns1: "", ns2: "" });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("ALL");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
    loadZones().finally(() => setLoading(false));
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
    const ok = await confirm("Delete this DNS record?", {
      title: "Delete DNS record",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
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

  function toggleZone(zoneId: string) {
    setCollapsed((prev) => ({ ...prev, [zoneId]: !prev[zoneId] }));
  }

  function setAllCollapsed(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const zone of zones) next[zone.id] = value;
    setCollapsed(next);
  }

  const filtered = useMemo(() => {
    return zones
      .map((zone) => {
        const records = zone.records.filter((record) => {
          if (typeFilter !== "ALL" && record.type !== typeFilter) return false;
          if (!search.trim()) return true;
          return matchesSearch(
            search,
            zone.domain.name,
            zone.domain.server.ipAddress,
            record.name,
            record.type,
            record.value,
            recordLabel(record.name, zone.domain.name)
          );
        });
        return { ...zone, records };
      })
      .filter((zone) => {
        if (typeFilter !== "ALL") return zone.records.length > 0;
        if (!search.trim()) return true;
        return (
          zone.records.length > 0 ||
          matchesSearch(search, zone.domain.name, zone.domain.server.ipAddress)
        );
      });
  }, [zones, search, typeFilter]);

  const totalRecords = filtered.reduce((n, z) => n + z.records.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="DNS Zones"
        description="Manage DNS records for your domains."
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search zones or records..."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2 text-sm text-slate-400">
          <Network className="h-4 w-4 text-emerald-400" />
          <span className="text-xs uppercase tracking-wider text-slate-500">NS</span>
          <span className="font-mono text-emerald-300">{nameservers.ns1 || "—"}</span>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-emerald-300">{nameservers.ns2 || "—"}</span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2 text-sm text-slate-400">
          <span className="text-white">{filtered.length}</span> zone
          {filtered.length === 1 ? "" : "s"}
          <span className="mx-1.5 text-slate-600">·</span>
          <span className="text-white">{totalRecords}</span> record
          {totalRecords === 1 ? "" : "s"}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TYPES.map((type) => {
            const active = typeFilter === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-emerald-600 text-white"
                    : "border border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                {type === "ALL" ? "All types" : type}
              </button>
            );
          })}
        </div>
        {filtered.length > 1 ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAllCollapsed(false)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Expand all
            </button>
            <span className="text-slate-700">|</span>
            <button
              type="button"
              onClick={() => setAllCollapsed(true)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Collapse all
            </button>
          </div>
        ) : null}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={`${modalMode === "edit" ? "Edit" : "Add"} DNS Record${
          activeZone ? ` — ${activeZone.domain.name}` : ""
        }`}
        description="Use @ for the root domain, or a label like www, mail, or blog."
      >
        <form onSubmit={handleSaveRecord} className="space-y-6">
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

      <div className="space-y-3">
        {filtered.map((zone) => {
          const isCollapsed = Boolean(collapsed[zone.id]);
          const fullCount = zones.find((z) => z.id === zone.id)?.records.length ?? zone.records.length;

          return (
            <div
              key={zone.id}
              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
            >
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => toggleZone(zone.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-slate-900/80"
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-white">{zone.domain.name}</p>
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-400">
                        {zone.records.length}
                        {typeFilter !== "ALL" || search.trim()
                          ? ` / ${fullCount}`
                          : ""}{" "}
                        records
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Serial {zone.serial}
                      {zone.syncedAt ? ` · Synced ${formatDate(zone.syncedAt)}` : ""}
                      {zone.lastError ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-red-400">
                          <AlertCircle className="h-3 w-3" />
                          {zone.lastError}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </button>

                <div className="flex flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
                  <button
                    type="button"
                    onClick={() => openAddRecord(zone)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddMailRecords(zone.domain.id)}
                    disabled={loading}
                    title="Add mail records"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Mail
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRetry(zone.domain.id)}
                    disabled={loading}
                    title="Re-sync zone"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    Sync
                  </button>
                </div>
              </div>

              {!isCollapsed ? (
                <div className="border-t border-slate-800/80">
                  {zone.records.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-slate-500">
                      {typeFilter !== "ALL" || search.trim()
                        ? "No records match this filter."
                        : "No records in this zone yet."}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-800/80 text-[10px] uppercase tracking-wider text-slate-500">
                            <th className="px-4 py-2.5 font-medium sm:px-5">Name</th>
                            <th className="px-4 py-2.5 font-medium sm:px-5">Type</th>
                            <th className="px-4 py-2.5 font-medium sm:px-5">Value</th>
                            <th className="px-4 py-2.5 font-medium sm:px-5">TTL</th>
                            <th className="px-4 py-2.5 font-medium sm:px-5">Pri</th>
                            <th className="px-4 py-2.5 font-medium sm:px-5" />
                          </tr>
                        </thead>
                        <tbody>
                          {zone.records.map((record) => (
                            <tr
                              key={record.id}
                              className="border-b border-slate-800/40 last:border-0 hover:bg-slate-900/40"
                            >
                              <td className="px-4 py-2.5 font-mono text-xs text-emerald-300/90 sm:px-5 sm:text-sm">
                                {recordLabel(record.name, zone.domain.name)}
                              </td>
                              <td className="px-4 py-2.5 sm:px-5">
                                <span
                                  className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ring-inset ${typeBadgeClass(record.type)}`}
                                >
                                  {record.type}
                                </span>
                              </td>
                              <td
                                className="max-w-[14rem] truncate px-4 py-2.5 font-mono text-xs text-slate-400 sm:max-w-xs sm:px-5 sm:text-sm"
                                title={record.value}
                              >
                                {record.value}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-slate-500 sm:px-5">
                                {record.ttl}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-slate-500 sm:px-5">
                                {record.priority ?? "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right sm:px-5">
                                <div className="inline-flex items-center gap-0.5">
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
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-slate-500">
            {loading && zones.length === 0
              ? "Loading DNS zones…"
              : zones.length === 0
                ? "No DNS zones yet. Add a domain to auto-create a zone."
                : "No zones match your search or filter."}
          </div>
        )}
      </div>
    </div>
  );
}
