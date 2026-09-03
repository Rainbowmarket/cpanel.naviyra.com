"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { docsByCategory, type DocArticle } from "@/lib/docs/content";

export default function DocsIndexPage() {
  const [role, setRole] = useState<string>("");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

  const groups = useMemo(() => docsByCategory(role || undefined), [role]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        articles: g.articles.filter(
          (a) =>
            a.title.toLowerCase().includes(needle) ||
            a.summary.toLowerCase().includes(needle) ||
            a.slug.includes(needle)
        ),
      }))
      .filter((g) => g.articles.length > 0);
  }, [groups, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentation"
        description="How to add, run, and use each panel feature."
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search docs…"
      />

      <p className="text-sm text-slate-400">
        Step-by-step guides for everything in Naviyra Panel — create resources,
        run actions, and notes on specialties (runtimes, WebSockets, terminal
        limits, and more).
      </p>

      {filtered.map((group) => (
        <section key={group.category} className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {group.category}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {group.articles.map((article) => (
              <DocCard key={article.slug} article={article} />
            ))}
          </div>
        </section>
      ))}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-sm text-slate-500">
          No articles match “{q}”.
        </p>
      ) : null}
    </div>
  );
}

function DocCard({ article }: { article: DocArticle }) {
  return (
    <Link
      href={`/dashboard/docs/${article.slug}`}
      className="group flex flex-col rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-emerald-500/30 hover:bg-slate-900/70"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="font-medium text-white">{article.title}</span>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:text-emerald-400" />
      </div>
      <p className="mt-2 flex-1 text-sm text-slate-400">{article.summary}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500">
        <ExternalLink className="h-3 w-3" />
        Open feature
      </span>
    </Link>
  );
}
