"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  Ban,
  ChevronDown,
  ChevronRight,
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
import { useAlert } from "@/components/ui/alert-provider";
import { cn } from "@/lib/utils";

type DatePreset = "today" | "yesterday" | "custom" | "all";
type BotFilter = "all" | "human" | "bot";
type CodeFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx";

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
  { id: "blocked", label: "Blocked" },
  { id: "whitelist", label: "Whitelist" },
] as const;

type Tab = (typeof tabs)[number]["id"];

const fieldClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-500/40";

function matchesCodeFilter(code: number | null | undefined, filter: CodeFilter) {
  if (filter === "all") return true;
  if (code == null) return false;
  if (filter === "2xx") return code >= 200 && code < 300;
  if (filter === "3xx") return code >= 300 && code < 400;
  if (filter === "4xx") return code >= 400 && code < 500;
  return code >= 500;
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    CRITICAL: "bg-red-500/15 text-red-300",
    HIGH: "bg-red-500/15 text-red-300",
    MEDIUM: "bg-amber-500/15 text-amber-300",
    LOW: "bg-slate-800 text-slate-400",
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
        active
          ? "bg-emerald-600 text-white"
          : "border border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
      )}
    >
      {children}
    </button>
  );
}

export default function SecurityPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Loading security...</p>}>
      <SecurityPageInner />
    </Suspense>
  );
}

function SecurityPageInner() {
  const { confirm } = useAlert();
  const searchParams = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get("tab");
    if (
      t === "visitors" ||
      t === "threats" ||
      t === "blocked" ||
      t === "whitelist" ||
      t === "overview"
    ) {
      return t;
    }
    return "overview";
  })();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [live, setLive] = useState<LiveRow[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [autoBlockTtlHours, setAutoBlockTtlHours] = useState(48);
  const [whitelist, setWhitelist] = useState<WhitelistRow[]>([]);
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [botFilter, setBotFilter] = useState<BotFilter>("all");
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("all");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [groupByDomain, setGroupByDomain] = useState(true);
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);
  const [blockIp, setBlockIp] = useState("");
  const [blockReason, setBlockReason] = useState("Manual block");
  const [whiteIp, setWhiteIp] = useState("");
  const [whiteLabel, setWhiteLabel] = useState("");

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
      fetch(
        `/api/security/visitors?live=1${domainId ? `&domainId=${domainId}` : ""}`
      ).then((r) => r.json()),
    ]);
    setStats(s.stats);
    setLive(l.live ?? []);
  }, [domainId, domainQuery]);

  const loadVisitors = useCallback(async () => {
    const data = await fetch(`/api/security/visitors?${buildVisitorQuery()}`).then(
      (r) => r.json()
    );
    setVisitors(data.visitors ?? []);
  }, [buildVisitorQuery]);

  async function exportVisitorsCsv() {
    setExporting(true);
    try {
      const res = await fetch(
        `/api/security/visitors?${buildVisitorQuery({ format: "csv" })}`
      );
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
    const data = await fetch(`/api/security/events${domainQuery}`).then((r) =>
      r.json()
    );
    setEvents(data.events ?? []);
  }, [domainQuery]);

  const loadBlocked = useCallback(async () => {
    const data = await fetch("/api/security/blocklist").then((r) => r.json());
    setBlocked(data.blocked ?? []);
    if (typeof data.autoBlockTtlHours === "number") {
      setAutoBlockTtlHours(data.autoBlockTtlHours);
    }
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

  async function blockFromEvent(id: string) {
    const ok = await confirm("Block this IP?", {
      title: "Block IP",
      danger: true,
      confirmLabel: "Block",
    });
    if (!ok) return;
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
    const ok = await confirm(`Unblock ${ip}?`, {
      title: "Unblock IP",
      tone: "warning",
      confirmLabel: "Unblock",
    });
    if (!ok) return;
    await fetch(`/api/security/blocklist?ip=${encodeURIComponent(ip)}`, {
      method: "DELETE",
    });
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

  const filteredVisitors = useMemo(() => {
    return visitors.filter((v) => {
      if (botFilter === "bot" && !v.isBot) return false;
      if (botFilter === "human" && v.isBot) return false;
      if (!matchesCodeFilter(v.statusCode, codeFilter)) return false;
      return true;
    });
  }, [visitors, botFilter, codeFilter]);

  const visitorsByDomain = useMemo(() => {
    const map = new Map<string, Visitor[]>();
    for (const v of filteredVisitors) {
      const key = v.domain.name;
      const list = map.get(key) ?? [];
      list.push(v);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredVisitors]);

  const filteredEvents = useMemo(() => {
    if (severityFilter === "ALL") return events;
    return events.filter((e) => e.severity === severityFilter);
  }, [events, severityFilter]);

  const overviewStats = stats
    ? [
        { label: "Visitors", value: stats.visitorsToday, icon: Eye },
        { label: "Unique", value: stats.uniqueToday, icon: Users },
        { label: "Live", value: stats.liveNow, icon: Activity },
        { label: "Threats", value: stats.threatsToday, icon: ShieldAlert, alert: stats.threatsToday > 0 },
        { label: "Blocked", value: stats.blockedIps, icon: Ban, alert: stats.blockedIps > 0 },
        { label: "Domains", value: stats.domains, icon: Globe },
      ]
    : [];

  function toggleDomainFold(name: string) {
    setCollapsedDomains((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  function renderVisitorRows(rows: Visitor[]) {
    return rows.map((v) => (
      <tr key={v.id} className="border-t border-slate-800/50 hover:bg-slate-900/40">
        <td className="whitespace-nowrap px-3 py-2 text-[11px] text-slate-500 sm:px-4">
          {new Date(v.visitedAt).toLocaleString()}
        </td>
        {!groupByDomain ? (
          <td className="px-3 py-2 text-xs text-slate-300 sm:px-4">{v.domain.name}</td>
        ) : null}
        <td className="px-3 py-2 font-mono text-xs text-slate-200 sm:px-4">{v.ipAddress}</td>
        <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-slate-400 sm:max-w-xs sm:px-4" title={v.url}>
          {v.url}
        </td>
        <td className={cn("px-3 py-2 font-mono text-xs font-medium sm:px-4", statusCodeClass(v.statusCode))}>
          {v.statusCode ?? "—"}
        </td>
        <td className="px-3 py-2 text-xs text-slate-400 sm:px-4">
          {v.browser ?? "—"} / {v.os ?? "—"}
          {v.isBot ? (
            <span className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
              bot
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-xs text-slate-500 sm:px-4">{v.countryName ?? "—"}</td>
      </tr>
    ));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Security"
          description="Visitor traffic, threats, and IP access controls."
        />
        <Select
          value={domainId}
          onChange={setDomainId}
          options={[
            { value: "", label: "All domains" },
            ...domains.map((d) => ({ value: d.id, label: d.name })),
          ]}
          placeholder="All domains"
          className="w-full sm:w-52"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {tab === "overview" && stats && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
              {overviewStats.map((stat, idx) => {
                const Icon = stat.icon;
                return (
                  <button
                    key={stat.label}
                    type="button"
                    onClick={() => {
                      if (stat.label === "Threats") setTab("threats");
                      else if (stat.label === "Blocked") setTab("blocked");
                      else if (stat.label === "Live" || stat.label === "Visitors" || stat.label === "Unique") {
                        setTab("visitors");
                      }
                    }}
                    className={cn(
                      "px-4 py-3.5 text-left transition hover:bg-slate-900/60",
                      idx % 2 === 1 ? "border-l border-slate-800" : "",
                      idx >= 2 ? "border-t border-slate-800 sm:border-t-0" : "",
                      idx >= 1 ? "sm:border-l sm:border-slate-800" : "",
                      idx >= 3 ? "xl:border-t-0" : ""
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        {stat.label}
                      </p>
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5",
                          "alert" in stat && stat.alert ? "text-amber-400" : "text-emerald-400"
                        )}
                      />
                    </div>
                    <p
                      className={cn(
                        "mt-1.5 text-xl font-semibold tabular-nums",
                        "alert" in stat && stat.alert ? "text-amber-200" : "text-white"
                      )}
                    >
                      {stat.value.toLocaleString()}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 sm:px-5">
              <h2 className="text-sm font-semibold text-white">Live visitors</h2>
              <span className="text-[11px] text-slate-500">Updates every 15s</span>
            </div>
            {live.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                No active visitors right now.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-2.5 font-medium sm:px-5">Domain</th>
                      <th className="px-4 py-2.5 font-medium sm:px-5">IP</th>
                      <th className="px-4 py-2.5 font-medium sm:px-5">Page</th>
                      <th className="px-4 py-2.5 font-medium sm:px-5">Browser</th>
                      <th className="px-4 py-2.5 font-medium sm:px-5">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((v) => (
                      <tr key={v.id} className="border-t border-slate-800/50 hover:bg-slate-900/40">
                        <td className="px-4 py-2.5 text-xs text-slate-300 sm:px-5">{v.domain.name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-200 sm:px-5">{v.ipAddress}</td>
                        <td className="max-w-xs truncate px-4 py-2.5 text-xs text-slate-500 sm:px-5">{v.url}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-400 sm:px-5">{v.browser}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                          {new Date(v.lastSeen).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "visitors" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["today", "Today"],
                  ["yesterday", "Yesterday"],
                  ["custom", "Custom"],
                  ["all", "All time"],
                ] as const
              ).map(([id, label]) => (
                <Chip
                  key={id}
                  active={datePreset === id}
                  onClick={() => {
                    setDatePreset(id);
                    if (id === "custom" && !customFrom && !customTo) {
                      const y = new Date();
                      y.setDate(y.getDate() - 1);
                      setCustomFrom(toDateInputValue(y));
                      setCustomTo(toDateInputValue(new Date()));
                    }
                  }}
                >
                  {label}
                </Chip>
              ))}
              <span className="mx-1 hidden h-4 w-px bg-slate-800 sm:inline" />
              {(
                [
                  ["all", "All traffic"],
                  ["human", "Human"],
                  ["bot", "Bots"],
                ] as const
              ).map(([id, label]) => (
                <Chip key={id} active={botFilter === id} onClick={() => setBotFilter(id)}>
                  {label}
                </Chip>
              ))}
              <span className="mx-1 hidden h-4 w-px bg-slate-800 sm:inline" />
              {(
                [
                  ["all", "All codes"],
                  ["2xx", "2xx"],
                  ["3xx", "3xx"],
                  ["4xx", "4xx"],
                  ["5xx", "5xx"],
                ] as const
              ).map(([id, label]) => (
                <Chip key={id} active={codeFilter === id} onClick={() => setCodeFilter(id)}>
                  {label}
                </Chip>
              ))}
            </div>

            {datePreset === "custom" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className={fieldClass}
                />
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className={fieldClass}
                />
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className={cn(fieldClass, "min-w-[12rem] flex-1")}
                placeholder="Search IP, URL, browser…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Chip active={groupByDomain} onClick={() => setGroupByDomain((v) => !v)}>
                Fold by domain
              </Chip>
              <button
                type="button"
                onClick={() => void exportVisitorsCsv()}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? "Exporting…" : "CSV"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <p>
              {visitorRange.label}
              <span className="mx-1.5 text-slate-700">·</span>
              <span className="text-slate-300">{filteredVisitors.length}</span> shown
              {filteredVisitors.length !== visitors.length ? (
                <>
                  <span className="mx-1.5 text-slate-700">·</span>
                  {visitors.length} loaded
                </>
              ) : null}
            </p>
            {groupByDomain && visitorsByDomain.length > 1 ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="hover:text-slate-300"
                  onClick={() => setCollapsedDomains({})}
                >
                  Expand all
                </button>
                <span className="text-slate-700">|</span>
                <button
                  type="button"
                  className="hover:text-slate-300"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const [name] of visitorsByDomain) next[name] = true;
                    setCollapsedDomains(next);
                  }}
                >
                  Collapse all
                </button>
              </div>
            ) : null}
          </div>

          {filteredVisitors.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
              No visitors for {visitorRange.label.toLowerCase()}.
            </div>
          ) : groupByDomain ? (
            <div className="space-y-2">
              {visitorsByDomain.map(([domainName, rows]) => {
                const folded = Boolean(collapsedDomains[domainName]);
                return (
                  <div
                    key={domainName}
                    className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80"
                  >
                    <button
                      type="button"
                      onClick={() => toggleDomainFold(domainName)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-900/60 sm:px-4"
                    >
                      {folded ? (
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-500" />
                      )}
                      <span className="font-medium text-white">{domainName}</span>
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {rows.length}
                      </span>
                    </button>
                    {!folded ? (
                      <div className="overflow-x-auto border-t border-slate-800">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                              <th className="px-3 py-2 font-medium sm:px-4">Time</th>
                              <th className="px-3 py-2 font-medium sm:px-4">IP</th>
                              <th className="px-3 py-2 font-medium sm:px-4">URL</th>
                              <th className="px-3 py-2 font-medium sm:px-4">Code</th>
                              <th className="px-3 py-2 font-medium sm:px-4">Browser / OS</th>
                              <th className="px-3 py-2 font-medium sm:px-4">Country</th>
                            </tr>
                          </thead>
                          <tbody>{renderVisitorRows(rows)}</tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <TableShell empty={false} emptyText="">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2.5 font-medium sm:px-4">Time</th>
                  <th className="px-3 py-2.5 font-medium sm:px-4">Domain</th>
                  <th className="px-3 py-2.5 font-medium sm:px-4">IP</th>
                  <th className="px-3 py-2.5 font-medium sm:px-4">URL</th>
                  <th className="px-3 py-2.5 font-medium sm:px-4">Code</th>
                  <th className="px-3 py-2.5 font-medium sm:px-4">Browser / OS</th>
                  <th className="px-3 py-2.5 font-medium sm:px-4">Country</th>
                </tr>
              </thead>
              <tbody>{renderVisitorRows(filteredVisitors)}</tbody>
            </TableShell>
          )}
        </div>
      )}

      {tab === "threats" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
              <Chip
                key={s}
                active={severityFilter === s}
                onClick={() => setSeverityFilter(s)}
              >
                {s === "ALL" ? "All severities" : s}
              </Chip>
            ))}
          </div>
          <TableShell empty={filteredEvents.length === 0} emptyText="No threats detected.">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5 font-medium sm:px-4">Time</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Type</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Severity</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">IP</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Domain</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Code</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Details</th>
                <th className="px-3 py-2.5 font-medium sm:px-4" />
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((e) => (
                <tr key={e.id} className="border-t border-slate-800/50 hover:bg-slate-900/40">
                  <td className="whitespace-nowrap px-3 py-2 text-[11px] text-slate-500 sm:px-4">
                    {new Date(e.detectedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300 sm:px-4">
                    {e.threatType.replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-2 sm:px-4">
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase",
                        severityBadge(e.severity)
                      )}
                    >
                      {e.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs sm:px-4">{e.ipAddress}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 sm:px-4">
                    {e.domain?.name ?? "—"}
                  </td>
                  <td className={cn("px-3 py-2 font-mono text-xs font-medium sm:px-4", statusCodeClass(e.statusCode))}>
                    {e.statusCode ?? "—"}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-slate-500 sm:max-w-xs sm:px-4">
                    {e.url} {e.payload ? `· ${e.payload.slice(0, 40)}` : ""}
                  </td>
                  <td className="px-3 py-2 sm:px-4">
                    <button
                      type="button"
                      onClick={() => blockFromEvent(e.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-red-500/40 hover:text-red-300"
                    >
                      <Ban className="h-3 w-3" />
                      Block
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      )}

      {tab === "blocked" && (
        <div className="space-y-3">
          <form
            onSubmit={addBlock}
            className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3.5"
          >
            <input
              className={fieldClass}
              placeholder="IP address"
              value={blockIp}
              onChange={(e) => setBlockIp(e.target.value)}
              required
            />
            <input
              className={cn(fieldClass, "min-w-[12rem] flex-1")}
              placeholder="Reason"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              required
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
            >
              <Plus className="h-3.5 w-3.5" />
              Block IP
            </button>
          </form>
          <TableShell empty={blocked.length === 0} emptyText="No blocked IPs.">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5 font-medium sm:px-4">IP</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Reason</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Source</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Via</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Blocked</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Expires</th>
                <th className="px-3 py-2.5 font-medium sm:px-4" />
              </tr>
            </thead>
            <tbody>
              {blocked.map((b) => {
                const isAuto = b.source.toLowerCase() === "auto";
                const expires = isAuto
                  ? new Date(
                      new Date(b.blockedAt).getTime() +
                        autoBlockTtlHours * 60 * 60 * 1000
                    )
                  : null;
                return (
                  <tr key={b.id} className="border-t border-slate-800/50 hover:bg-slate-900/40">
                    <td className="px-3 py-2 font-mono text-xs sm:px-4 sm:text-sm">{b.ipAddress}</td>
                    <td className="px-3 py-2 text-xs text-slate-300 sm:px-4">{b.reason}</td>
                    <td className="px-3 py-2 sm:px-4">
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                        {b.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 sm:px-4">{b.blockedVia}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 sm:px-4">
                      {new Date(b.blockedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 sm:px-4">
                      {expires ? expires.toLocaleString() : "Never"}
                    </td>
                    <td className="px-3 py-2 sm:px-4">
                      <button
                        type="button"
                        onClick={() => unblock(b.ipAddress)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                      >
                        <Unlock className="h-3 w-3" />
                        Unblock
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        </div>
      )}

      {tab === "whitelist" && (
        <div className="space-y-3">
          <form
            onSubmit={addWhite}
            className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3.5"
          >
            <input
              className={fieldClass}
              placeholder="IP address"
              value={whiteIp}
              onChange={(e) => setWhiteIp(e.target.value)}
              required
            />
            <input
              className={cn(fieldClass, "min-w-[12rem] flex-1")}
              placeholder="Label (optional)"
              value={whiteLabel}
              onChange={(e) => setWhiteLabel(e.target.value)}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
            >
              <Plus className="h-3.5 w-3.5" />
              Add IP
            </button>
          </form>
          <TableShell empty={whitelist.length === 0} emptyText="No whitelisted IPs.">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5 font-medium sm:px-4">IP</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Label</th>
                <th className="px-3 py-2.5 font-medium sm:px-4">Added</th>
                <th className="px-3 py-2.5 font-medium sm:px-4" />
              </tr>
            </thead>
            <tbody>
              {whitelist.map((w) => (
                <tr key={w.id} className="border-t border-slate-800/50 hover:bg-slate-900/40">
                  <td className="px-3 py-2 font-mono text-xs sm:px-4 sm:text-sm">{w.ipAddress}</td>
                  <td className="px-3 py-2 text-xs text-slate-400 sm:px-4">{w.label ?? "—"}</td>
                  <td className="px-3 py-2 text-[11px] text-slate-500 sm:px-4">
                    {new Date(w.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 sm:px-4">
                    <button
                      type="button"
                      onClick={() => removeWhite(w.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-red-500/40 hover:text-red-300"
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
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80">
      {empty ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">{children}</table>
        </div>
      )}
    </div>
  );
}
