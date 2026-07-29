"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  Download,
  Eye,
  Globe,
  Plus,
  ShieldAlert,
  Trash2,
  Unlock,
  Users,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

type DatePreset = "today" | "yesterday" | "custom" | "all";

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveVisitorRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string
): { from?: string; to?: string; label: string } {
  const now = new Date();
  if (preset === "today") {
    const f = toDateInputValue(now);
    return { from: f, to: f, label: "Today" };
  }
  if (preset === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const f = toDateInputValue(y);
    return { from: f, to: f, label: "Yesterday" };
  }
  if (preset === "custom") {
    return {
      from: customFrom || undefined,
      to: customTo || undefined,
      label:
        customFrom && customTo
          ? `${customFrom} → ${customTo}`
          : customFrom
            ? `From ${customFrom}`
            : customTo
              ? `Until ${customTo}`
              : "Custom range",
    };
  }
  return { label: "All time" };
}

type Domain = { id: string; name: string };
type Stats = {
  visitorsToday: number;
  uniqueToday: number;
  threatsToday: number;
  blockedIps: number;
  liveNow: number;
  domains: number;
};
type LiveRow = {
  id: string;
  ipAddress: string;
  url: string | null;
  browser: string | null;
  countryCode: string | null;
  lastSeen: string;
  domain: { name: string };
};
type Visitor = {
  id: string;
  ipAddress: string;
  url: string;
  browser: string | null;
  os: string | null;
  countryName: string | null;
  visitedAt: string;
  statusCode: number | null;
  isBot: boolean;
  domain: { name: string };
};
type Event = {
  id: string;
  ipAddress: string;
  threatType: string;
  severity: string;
  url: string | null;
  payload: string | null;
  statusCode: number | null;
  actionTaken: string;
  detectedAt: string;
  domain: { name: string } | null;
};
type Blocked = {
  id: string;
  ipAddress: string;
  reason: string;
  source: string;
  blockedVia: string;
  blockedAt: string;
};
type WhitelistRow = { id: string; ipAddress: string; label: string | null; createdAt: string };

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "visitors", label: "Visitors" },
  { id: "threats", label: "Threats" },
  { id: "blocked", label: "Blocked IPs" },
  { id: "whitelist", label: "Whitelist" },
] as const;

type Tab = (typeof tabs)[number]["id"];

function StatBox({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-bold text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-emerald-400" />
      </div>
    </div>
  );
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    CRITICAL: "bg-red-500/15 text-red-300 ring-red-500/30",
    HIGH: "bg-red-500/15 text-red-300 ring-red-500/30",
    MEDIUM: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    LOW: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
  };
  return map[severity] ?? map.LOW;
}

function statusCodeClass(code: number | null | undefined) {
  if (code == null) return "text-slate-500";
  if (code >= 500) return "text-red-400";
  if (code >= 400) return "text-amber-400";
  if (code >= 300) return "text-sky-400";
  if (code >= 200) return "text-emerald-400";
  return "text-slate-400";
}

export default function SecurityPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [live, setLive] = useState<LiveRow[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistRow[]>([]);
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [blockIp, setBlockIp] = useState("");
  const [blockReason, setBlockReason] = useState("Manual block");
  const [whiteIp, setWhiteIp] = useState("");
  const [whiteLabel, setWhiteLabel] = useState("");
  const [simulating, setSimulating] = useState(false);

  const domainQuery = domainId ? `?domainId=${domainId}` : "";

  const visitorRange = useMemo(
    () => resolveVisitorRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo]
  );

  const buildVisitorQuery = useCallback(
    (extra?: Record<string, string>) => {
      const q = new URLSearchParams();
      if (domainId) q.set("domainId", domainId);
      if (search) q.set("search", search);
      if (visitorRange.from) q.set("from", visitorRange.from);
      if (visitorRange.to) q.set("to", visitorRange.to);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) q.set(k, v);
      }
      return q;
    },
    [domainId, search, visitorRange.from, visitorRange.to]
  );

  const loadOverview = useCallback(async () => {
    const [s, l] = await Promise.all([
      fetch(`/api/security/overview${domainQuery}`).then((r) => r.json()),
      fetch(`/api/security/visitors?live=1${domainId ? `&domainId=${domainId}` : ""}`).then((r) => r.json()),
    ]);
    setStats(s.stats);
    setLive(l.live ?? []);
  }, [domainId, domainQuery]);

  const loadVisitors = useCallback(async () => {
    const data = await fetch(`/api/security/visitors?${buildVisitorQuery()}`).then((r) => r.json());
    setVisitors(data.visitors ?? []);
  }, [buildVisitorQuery]);

  async function exportVisitorsCsv() {
    setExporting(true);
    try {
      const res = await fetch(`/api/security/visitors?${buildVisitorQuery({ format: "csv" })}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `visitors-${visitorRange.from || "all"}-${visitorRange.to || "now"}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }
  const loadEvents = useCallback(async () => {
    const data = await fetch(`/api/security/events${domainQuery}`).then((r) => r.json());
    setEvents(data.events ?? []);
  }, [domainQuery]);

  const loadBlocked = useCallback(async () => {
    const data = await fetch("/api/security/blocklist").then((r) => r.json());
    setBlocked(data.blocked ?? []);
  }, []);

  const loadWhitelist = useCallback(async () => {
    const data = await fetch("/api/security/whitelist").then((r) => r.json());
    setWhitelist(data.whitelist ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/domains")
      .then((r) => r.json())
      .then((d) => setDomains(d.domains ?? []));
  }, []);

  useEffect(() => {
    if (tab === "overview") loadOverview();
    if (tab === "visitors") loadVisitors();
    if (tab === "threats") loadEvents();
    if (tab === "blocked") loadBlocked();
    if (tab === "whitelist") loadWhitelist();
  }, [tab, loadOverview, loadVisitors, loadEvents, loadBlocked, loadWhitelist]);

  useEffect(() => {
    if (tab !== "overview") return;
    const t = setInterval(loadOverview, 15000);
    return () => clearInterval(t);
  }, [tab, loadOverview]);

  async function simulateThreat() {
    if (!domainId && domains[0]) setDomainId(domains[0].id);
    const id = domainId || domains[0]?.id;
    if (!id) return;
    setSimulating(true);
    await fetch("/api/security/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId: id,
        ipAddress: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
        url: "/wp-admin?id=1' OR 1=1--",
        userAgent: "sqlmap/1.0",
        method: "GET",
      }),
    });
    setSimulating(false);
    loadOverview();
    loadEvents();
  }

  async function blockFromEvent(id: string) {
    if (!confirm("Block this IP?")) return;
    await fetch(`/api/security/events?id=${id}`, { method: "PATCH" });
    loadEvents();
    loadBlocked();
  }

  async function addBlock(e: FormEvent) {
    e.preventDefault();
    await fetch("/api/security/blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip: blockIp, reason: blockReason }),
    });
    setBlockIp("");
    loadBlocked();
  }

  async function unblock(ip: string) {
    if (!confirm(`Unblock ${ip}?`)) return;
    await fetch(`/api/security/blocklist?ip=${encodeURIComponent(ip)}`, { method: "DELETE" });
    loadBlocked();
  }

  async function addWhite(e: FormEvent) {
    e.preventDefault();
    await fetch("/api/security/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip: whiteIp, label: whiteLabel }),
    });
    setWhiteIp("");
    setWhiteLabel("");
    loadWhitelist();
  }

  async function removeWhite(id: string) {
    await fetch(`/api/security/whitelist?id=${id}`, { method: "DELETE" });
    loadWhitelist();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Manager"
        description="Monitor visitors, detect threats, and manage IP blocklists across all domains."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={domainId}
          onChange={setDomainId}
          options={[
            { value: "", label: "All domains" },
            ...domains.map((d) => ({ value: d.id, label: d.name })),
          ]}
          placeholder="All domains"
          className="w-56"
        />
        <button
          type="button"
          onClick={simulateThreat}
          disabled={simulating || domains.length === 0}
          className="rounded-lg border border-amber-500/30 px-4 py-2 text-sm text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
        >
          {simulating ? "Simulating…" : "Simulate threat (demo)"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition",
              tab === t.id
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && stats && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatBox label="Visitors today" value={stats.visitorsToday} icon={Eye} />
            <StatBox label="Unique IPs" value={stats.uniqueToday} icon={Users} />
            <StatBox label="Live now" value={stats.liveNow} icon={Activity} />
            <StatBox label="Threats today" value={stats.threatsToday} icon={ShieldAlert} />
            <StatBox label="Blocked IPs" value={stats.blockedIps} icon={Ban} />
            <StatBox label="Domains" value={stats.domains} icon={Globe} />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
            <div className="border-b border-slate-800 px-5 py-4 font-medium text-white">
              Live visitors
            </div>
            {live.length === 0 ? (
              <p className="px-5 py-10 text-center text-slate-500">No active visitors.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                    <th className="px-5 py-3">Domain</th>
                    <th className="px-5 py-3">IP</th>
                    <th className="px-5 py-3">Page</th>
                    <th className="px-5 py-3">Browser</th>
                    <th className="px-5 py-3">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((v) => (
                    <tr key={v.id} className="border-t border-slate-800/80">
                      <td className="px-5 py-3">{v.domain.name}</td>
                      <td className="px-5 py-3 font-mono text-xs">{v.ipAddress}</td>
                      <td className="max-w-xs truncate px-5 py-3 text-slate-400">{v.url}</td>
                      <td className="px-5 py-3">{v.browser}</td>
                      <td className="px-5 py-3 text-slate-400">
                        {new Date(v.lastSeen).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "visitors" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500">Range</label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["today", "Today"],
                    ["yesterday", "Yesterday"],
                    ["custom", "Custom"],
                    ["all", "All time"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setDatePreset(id);
                      if (id === "custom" && !customFrom && !customTo) {
                        const y = new Date();
                        y.setDate(y.getDate() - 1);
                        setCustomFrom(toDateInputValue(y));
                        setCustomTo(toDateInputValue(new Date()));
                      }
                    }}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm font-medium transition",
                      datePreset === id
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
                        : "border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {datePreset === "custom" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500">From</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500">To</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-emerald-500/50"
                  />
                </div>
              </>
            )}

            <div className="min-w-[220px] flex-1 space-y-1.5">
              <label className="text-xs font-medium text-slate-500">Search</label>
              <input
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500/50"
                placeholder="Search IP, URL, browser…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => void exportVisitorsCsv()}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>

          <p className="text-sm text-slate-500">
            Showing <span className="text-slate-300">{visitorRange.label}</span>
            {" · "}
            <span className="text-slate-300">{visitors.length}</span> records
          </p>

          <TableShell
            empty={visitors.length === 0}
            emptyText={`No visitors for ${visitorRange.label.toLowerCase()}.`}
          >
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-3">Time</th>
                <th className="px-5 py-3">Domain</th>
                <th className="px-5 py-3">IP</th>
                <th className="px-5 py-3">URL</th>
                <th className="px-5 py-3">Code</th>
                <th className="px-5 py-3">Browser / OS</th>
                <th className="px-5 py-3">Country</th>
              </tr>
            </thead>
            <tbody>
              {visitors.map((v) => (
                <tr key={v.id} className="border-t border-slate-800/80">
                  <td className="px-5 py-3 text-slate-400">{new Date(v.visitedAt).toLocaleString()}</td>
                  <td className="px-5 py-3">{v.domain.name}</td>
                  <td className="px-5 py-3 font-mono text-xs">{v.ipAddress}</td>
                  <td className="max-w-xs truncate px-5 py-3">{v.url}</td>
                  <td className={cn("px-5 py-3 font-mono text-xs font-semibold", statusCodeClass(v.statusCode))}>
                    {v.statusCode ?? "—"}
                  </td>
                  <td className="px-5 py-3">
                    {v.browser} / {v.os}
                    {v.isBot && (
                      <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-xs">bot</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{v.countryName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}

      {tab === "threats" && (
        <TableShell empty={events.length === 0} emptyText="No threats detected.">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <th className="px-5 py-3">Time</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Severity</th>
              <th className="px-5 py-3">IP</th>
              <th className="px-5 py-3">Domain</th>
              <th className="px-5 py-3">Code</th>
              <th className="px-5 py-3">Details</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-slate-800/80">
                <td className="px-5 py-3 text-slate-400">{new Date(e.detectedAt).toLocaleString()}</td>
                <td className="px-5 py-3">{e.threatType.replace(/_/g, " ")}</td>
                <td className="px-5 py-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs ring-1", severityBadge(e.severity))}>
                    {e.severity}
                  </span>
                </td>
                <td className="px-5 py-3 font-mono text-xs">{e.ipAddress}</td>
                <td className="px-5 py-3">{e.domain?.name ?? "—"}</td>
                <td className={cn("px-5 py-3 font-mono text-xs font-semibold", statusCodeClass(e.statusCode))}>
                  {e.statusCode ?? "—"}
                </td>
                <td className="max-w-xs truncate px-5 py-3 text-xs text-slate-400">
                  {e.url} {e.payload ? `· ${e.payload.slice(0, 40)}` : ""}
                </td>
                <td className="px-5 py-3">
                  <button
                    type="button"
                    onClick={() => blockFromEvent(e.id)}
                    className="flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                  >
                    <Ban className="h-3 w-3" />
                    Block
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {tab === "blocked" && (
        <div className="space-y-4">
          <form onSubmit={addBlock} className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <input
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-emerald-500/50"
              placeholder="IP address"
              value={blockIp}
              onChange={(e) => setBlockIp(e.target.value)}
              required
            />
            <input
              className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-emerald-500/50"
              placeholder="Reason"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              required
            />
            <button type="submit" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500">
              <Plus className="h-4 w-4" />
              Block IP
            </button>
          </form>
          <TableShell empty={blocked.length === 0} emptyText="No blocked IPs.">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-3">IP</th>
                <th className="px-5 py-3">Reason</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Via</th>
                <th className="px-5 py-3">Blocked</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {blocked.map((b) => (
                <tr key={b.id} className="border-t border-slate-800/80">
                  <td className="px-5 py-3 font-mono">{b.ipAddress}</td>
                  <td className="px-5 py-3">{b.reason}</td>
                  <td className="px-5 py-3">{b.source}</td>
                  <td className="px-5 py-3">{b.blockedVia}</td>
                  <td className="px-5 py-3 text-slate-400">{new Date(b.blockedAt).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => unblock(b.ipAddress)}
                      className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                    >
                      <Unlock className="h-3 w-3" />
                      Unblock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}

      {tab === "whitelist" && (
        <div className="space-y-4">
          <form onSubmit={addWhite} className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <input
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-emerald-500/50"
              placeholder="IP address"
              value={whiteIp}
              onChange={(e) => setWhiteIp(e.target.value)}
              required
            />
            <input
              className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-emerald-500/50"
              placeholder="Label (optional)"
              value={whiteLabel}
              onChange={(e) => setWhiteLabel(e.target.value)}
            />
            <button type="submit" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500">
              <Plus className="h-4 w-4" />
              Add IP
            </button>
          </form>
          <TableShell empty={whitelist.length === 0} emptyText="No whitelisted IPs.">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-3">IP</th>
                <th className="px-5 py-3">Label</th>
                <th className="px-5 py-3">Added</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {whitelist.map((w) => (
                <tr key={w.id} className="border-t border-slate-800/80">
                  <td className="px-5 py-3 font-mono">{w.ipAddress}</td>
                  <td className="px-5 py-3">{w.label ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-400">{new Date(w.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => removeWhite(w.id)}
                      className="flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}
    </div>
  );
}

function TableShell({
  children,
  empty,
  emptyText,
}: {
  children: React.ReactNode;
  empty: boolean;
  emptyText: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50">
      {empty ? (
        <p className="px-5 py-10 text-center text-slate-500">{emptyText}</p>
      ) : (
        <table className="w-full text-sm">{children}</table>
      )}
    </div>
  );
}
