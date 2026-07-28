"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function WebmailLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/webmail/login")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.accountId) {
          router.replace(`/mailbox/${d.accountId}`);
        }
      })
      .catch(() => {});
  }, [router]);

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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Naviyra Webmail
          </p>
          <h1 className="mt-2 text-2xl font-bold text-white">Sign in to mail</h1>
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
                placeholder="you@example.com"
                autoComplete="username"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-rose-400">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-400">
          <p className="font-medium text-slate-300">Mobile / desktop apps</p>
          <p className="mt-1">
            IMAP <span className="text-slate-200">993</span> · SMTP{" "}
            <span className="text-slate-200">587</span> /{" "}
            <span className="text-slate-200">465</span> · host{" "}
            <span className="font-mono text-slate-200">mail.yourdomain</span>
          </p>
        </div>
      </div>
    </div>
  );
}
