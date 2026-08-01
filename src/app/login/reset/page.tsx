"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/ui/brand-logo";

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!token) {
      setError("Missing reset token. Request a new link from the sign-in page.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Could not reset password"
        );
        return;
      }
      router.replace("/login?reset=1");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
      <div className="flex items-center gap-3">
        <BrandLogo size={40} priority />
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Naviyra Panel
        </p>
      </div>
      <h1 className="mt-4 text-2xl font-bold text-white">Set new password</h1>
      <p className="mt-1 text-sm text-slate-400">
        Choose a new password for your account.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500/50"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500/50"
          required
          minLength={8}
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !token}
          className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Update password"}
        </button>
        <Link
          href="/login/forgot"
          className="block text-center text-sm text-slate-400 hover:text-slate-300"
        >
          Request a new link
        </Link>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-slate-950 px-4 py-8">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-slate-400">
            Loading…
          </div>
        }
      >
        <ResetForm />
      </Suspense>
    </div>
  );
}
