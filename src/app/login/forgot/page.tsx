"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Could not send reset email"
        );
        return;
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-slate-950 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <div className="flex items-center gap-3">
          <BrandLogo size={40} priority />
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Naviyra Panel
          </p>
        </div>
        <h1 className="mt-4 text-2xl font-bold text-white">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your account email and we&apos;ll send a reset link.
        </p>

        {done ? (
          <div className="mt-8 space-y-4">
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              If an account exists for that email, a reset link has been sent.
              Check your inbox (and spam folder).
            </p>
            <Link
              href="/login"
              className="block text-center text-sm text-emerald-400 hover:text-emerald-300"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500/50"
              required
              autoComplete="email"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <Link
              href="/login"
              className="block text-center text-sm text-slate-400 hover:text-slate-300"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
