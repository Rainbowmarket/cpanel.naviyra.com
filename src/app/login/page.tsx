"use client";

import { FormEvent, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSetup, setIsSetup] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (searchParams.get("reset") === "1") {
      setInfo("Password updated. Sign in with your new password.");
    }
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.ok) router.replace("/dashboard");
      })
      .catch(() => {});

    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((d) => setIsSetup(!d.needsSetup))
      .catch(() => setIsSetup(true));
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");

    const res = await fetch("/api/auth/login", {
      method: isSetup ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isSetup
          ? { email, password }
          : { name, email, password, domain }
      ),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        data.warning ||
          data.error?.formErrors?.[0] ||
          (typeof data.error === "string" ? data.error : null) ||
          (isSetup ? "Invalid credentials" : "Setup failed")
      );
      return;
    }

    if (data.warning) {
      setError(data.warning);
    }

    router.push("/dashboard/domains");
    router.refresh();
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
        Naviyra Panel
      </p>
      <h1 className="mt-2 text-2xl font-bold text-white">
        {isSetup ? "Sign in" : "Initial setup"}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        {isSetup
          ? "Access your hosting control panel"
          : "Create the admin account and register this server’s main domain"}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {!isSetup && (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
              required
            />
            <div>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="Main domain (e.g. yourdomain.com)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
                required
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Registers primary server as{" "}
                <span className="font-mono text-slate-400">
                  server1.{domain.trim() || "yourdomain"}
                </span>
              </p>
            </div>
          </>
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
          required
        />
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
            required
            minLength={8}
          />
          {isSetup ? (
            <div className="mt-2 text-right">
              <Link
                href="/login/forgot"
                className="text-sm text-emerald-400 hover:text-emerald-300"
              >
                Forgot password?
              </Link>
            </div>
          ) : null}
        </div>
        {info && <p className="text-sm text-emerald-400">{info}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-500"
        >
          {isSetup ? "Sign in" : "Create admin & register server"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-slate-950 px-4 py-8">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-slate-400">
            Loading…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
