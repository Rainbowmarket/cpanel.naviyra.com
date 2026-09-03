"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { matchesSearch } from "@/lib/utils";

type FileTarget = {
  id: string;
  label: string;
  documentRoot: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
};

type DomainGroup = {
  domain: FileTarget;
  subs: FileTarget[];
};

function openFileManager(targetId: string) {
  const url = `/file-manager?target=${encodeURIComponent(targetId)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function FilesDirectoryPage() {
  const [targets, setTargets] = useState<FileTarget[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/file-manager/targets")
      .then((r) => r.json())
      .then((d) => {
        setTargets(d.targets ?? []);
        setIsAdmin(d.role === "ADMIN");
      })
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const domains = targets.filter((t) => t.id.startsWith("d:"));
    const subs = targets.filter((t) => t.id.startsWith("s:"));
    const out: DomainGroup[] = domains.map((domain) => {
      const base = domain.label.toLowerCase();
      return {
        domain,
        subs: subs.filter((s) => s.label.toLowerCase().endsWith(`.${base}`)),
      };
    });
    // orphan subdomains (shouldn't happen often)
    const claimed = new Set(out.flatMap((g) => g.subs.map((s) => s.id)));
    for (const s of subs) {
      if (claimed.has(s.id)) continue;
      out.push({
        domain: {
          id: s.id,
          label: s.label,
          documentRoot: s.documentRoot,
        },
        subs: [],
      });
    }
    return out;
  }, [targets]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    return groups
      .map((g) => {
        const domainMatch = matchesSearch(
          search,
          g.domain.label,
          g.domain.documentRoot,
          g.domain.ownerEmail,
          g.domain.ownerName
        );
        const matchedSubs = g.subs.filter((s) =>
          matchesSearch(
            search,
            s.label,
            s.documentRoot,
            s.ownerEmail,
            s.ownerName
          )
        );
        if (domainMatch) return g;
        if (matchedSubs.length > 0) return { ...g, subs: matchedSubs };
        return null;
      })
      .filter((g): g is DomainGroup => g != null);
  }, [groups, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="File Manager"
        description={
          isAdmin
            ? "All customer domains — choose a site, then open its files in a new tab."
            : "Choose a domain or subdomain, then open its files in a new tab."
        }
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={
          isAdmin ? "Search domains or owner email..." : "Search domains..."
        }
      />

      {loading ? (
        <p className="text-sm text-slate-500">Loading domains…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-sm text-slate-500">
          {targets.length === 0
            ? "No domains available. Add a domain first."
            : "No domains match your search."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((group) => {
            const folded = Boolean(collapsed[group.domain.id]);
            const hasSubs = group.subs.length > 0;
            return (
              <div
                key={group.domain.id}
                className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
              >
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
                  {hasSubs ? (
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((prev) => ({
                          ...prev,
                          [group.domain.id]: !prev[group.domain.id],
                        }))
                      }
                      className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                      aria-label={folded ? "Expand" : "Collapse"}
                    >
                      {folded ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <span className="w-6" />
                  )}

                  <FolderOpen className="h-4 w-4 shrink-0 text-emerald-400" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">
                      {group.domain.label}
                    </p>
                    {isAdmin && group.domain.ownerEmail ? (
                      <p className="truncate text-[11px] text-slate-400">
                        {group.domain.ownerName
                          ? `${group.domain.ownerName} · `
                          : ""}
                        {group.domain.ownerEmail}
                      </p>
                    ) : null}
                    <p
                      className="truncate font-mono text-[11px] text-slate-500"
                      title={group.domain.documentRoot}
                    >
                      {group.domain.documentRoot}
                    </p>
                  </div>

                  {hasSubs ? (
                    <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {group.subs.length} sub
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => openFileManager(group.domain.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Open
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>

                {hasSubs && !folded ? (
                  <ul className="border-t border-slate-800">
                    {group.subs.map((sub) => (
                      <li
                        key={sub.id}
                        className="flex flex-wrap items-center gap-2 border-t border-slate-800/60 px-3 py-2.5 first:border-t-0 sm:px-4 sm:pl-12"
                      >
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-200">
                            {sub.label}
                          </p>
                          <p
                            className="truncate font-mono text-[10px] text-slate-600"
                            title={sub.documentRoot}
                          >
                            {sub.documentRoot}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openFileManager(sub.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Search className="h-3.5 w-3.5" />
        File Manager opens in a new browser tab for the selected site.
      </p>
    </div>
  );
}
