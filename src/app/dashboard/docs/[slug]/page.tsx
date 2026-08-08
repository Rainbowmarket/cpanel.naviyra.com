"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Lightbulb,
  ListOrdered,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { getDocBySlug } from "@/lib/docs/content";

export default function DocArticlePage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params.slug ?? "");
  const article = getDocBySlug(slug);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

  useEffect(() => {
    if (!article) return;
    if (role === null) return;
    if (article.audience === "admin" && role !== "ADMIN") {
      router.replace("/dashboard/docs");
    }
  }, [article, role, router]);

  if (!article) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Article not found.</p>
        <Link
          href="/dashboard/docs"
          className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to docs
        </Link>
      </div>
    );
  }

  if (article.audience === "admin" && role !== null && role !== "ADMIN") {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        Redirecting…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/docs"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Docs
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-sm text-slate-500">{article.category}</span>
      </div>

      <PageHeader title={article.title} description={article.summary} />

      <p className="text-sm text-slate-400">{article.summary}</p>

      <div className="flex flex-wrap gap-2">
        <Link
          href={article.href}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        >
          <ExternalLink className="h-4 w-4" />
          Open {article.title.replace(/ \(.*\)$/, "")}
        </Link>
        {article.audience === "admin" ? (
          <span className="inline-flex items-center rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-300">
            Admin only
          </span>
        ) : null}
      </div>

      <div className="space-y-4">
        {article.sections.map((section) => (
          <article
            key={section.heading}
            className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 sm:p-5"
          >
            <h3 className="flex items-center gap-2 text-base font-semibold text-white">
              <BookOpen className="h-4 w-4 text-emerald-400" />
              {section.heading}
            </h3>

            {section.body?.length ? (
              <div className="mt-3 space-y-2">
                {section.body.map((p) => (
                  <p key={p} className="text-sm leading-relaxed text-slate-300">
                    {p}
                  </p>
                ))}
              </div>
            ) : null}

            {section.steps?.length ? (
              <ol className="mt-4 space-y-2">
                {section.steps.map((step, i) => (
                  <li
                    key={step}
                    className="flex gap-3 text-sm text-slate-300"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-300">
                      {i + 1}
                    </span>
                    <span className="pt-0.5 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            {section.tips?.length ? (
              <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-300/90">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Tips
                </p>
                <ul className="space-y-1.5">
                  {section.tips.map((tip) => (
                    <li
                      key={tip}
                      className="flex gap-2 text-sm text-slate-300"
                    >
                      <ListOrdered className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="border-t border-slate-800 pt-4">
        <Link
          href="/dashboard/docs"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          All documentation
        </Link>
      </div>
    </div>
  );
}
