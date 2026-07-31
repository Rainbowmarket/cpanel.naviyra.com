"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function WebmailLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mailHost, setMailHost] = useState("");

  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    setMailHost(host.startsWith("mail.") ? host : `mail.${host}`);

    fetch("/api/webmail/login")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.accountId) {
          router.replace(`/mailbox/${d.accountId}`);
        }
      })
      .catch(() => {});
  }, [router]);

  const domainLabel = useMemo(() => {
    if (!mailHost) return "";
    return mailHost.replace(/^mail\./i, "");
  }, [mailHost]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/webmail/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Invalid email or password");
        return;
      }
      router.push(`/mailbox/${data.accountId}`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.14),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(56,189,248,0.08),_transparent_45%)]"
      />
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/90 p-8 shadow-2xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Naviyra Webmail
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
            {domainLabel ? `Sign in · ${domainLabel}` : "Sign in to mail"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Use your full email address and mailbox password
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={
                  domainLabel ? `you@${domainLabel}` : "you@example.com"
                }
                autoComplete="username"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500/60"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mailbox password"
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500/60"
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-rose-400">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-400">
          <p className="font-medium text-slate-300">Mobile / desktop apps</p>
          <dl className="mt-3 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-xs sm:text-sm">
            <dt className="text-slate-500">IMAP host</dt>
            <dd className="font-mono text-slate-200">{mailHost || "mail.yourdomain"}</dd>
            <dt className="text-slate-500">IMAP port</dt>
            <dd className="font-mono text-slate-200">993 (SSL/TLS)</dd>
            <dt className="text-slate-500">SMTP host</dt>
            <dd className="font-mono text-slate-200">{mailHost || "mail.yourdomain"}</dd>
            <dt className="text-slate-500">SMTP port</dt>
            <dd className="font-mono text-slate-200">587 STARTTLS · 465 SSL</dd>
            <dt className="text-slate-500">Username</dt>
            <dd className="text-slate-200">full email address</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
