"use client";

import { FormEvent, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BrandLogo } from "@/components/ui/brand-logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [installedDomain, setInstalledDomain] = useState<string | null>(null);
  const [primaryHostname, setPrimaryHostname] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (searchParams.get("reset") === "1") {
      setInfo("Password updated. Sign in with your new password.");
    }
    if (searchParams.get("idle") === "1") {
      setInfo("You were signed out after 30 minutes of inactivity.");
    }
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.ok) router.replace("/dashboard");
      })
      .catch(() => {});

    fetch("/api/auth/setup")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (typeof d.needsSetup === "boolean") {
          setHasAccount(!d.needsSetup);
          if (typeof d.panelDomain === "string" && d.panelDomain.trim()) {
            setInstalledDomain(d.panelDomain.trim());
            setDomain(d.panelDomain.trim());
          }
          if (typeof d.primaryHostname === "string" && d.primaryHostname.trim()) {
            setPrimaryHostname(d.primaryHostname.trim());
          }
          if (d.error) setError(String(d.error));
          return;
        }
        setHasAccount(false);
      })
      .catch(() => setHasAccount(false));
  }, [router]);

  const isSignIn = hasAccount === true;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setSubmitting(true);

    try {
      if (needs2fa) {
        const res = await fetch("/api/auth/2fa/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: totpCode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof data.error === "string" ? data.error : "Invalid code"
          );
          return;
        }
        router.push("/dashboard/domains");
        router.refresh();
        return;
      }

      const res = await fetch("/api/auth/login", {
        method: isSignIn ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignIn
            ? { email, password }
            : { name, email, password, ...(installedDomain ? {} : { domain }) }
        ),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.warning ||
            data.error?.formErrors?.[0] ||
            (typeof data.error === "string" ? data.error : null) ||
            (isSignIn ? "Invalid credentials" : "Setup failed")
        );
        return;
      }

      if (data.requires2fa) {
        setNeeds2fa(true);
        setTotpCode("");
        setInfo("Enter the 6-digit code from your authenticator app (or a backup code).");
        return;
      }

      if (data.warning) {
        setError(data.warning);
      }

      router.push("/dashboard/domains");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (hasAccount === null) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-slate-400">
        Checking setup…
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
      <div className="flex items-center gap-3">
        <BrandLogo size={40} priority />
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Naviyra Panel
        </p>
      </div>
      <h1 className="mt-4 text-2xl font-bold text-white">
        {needs2fa
          ? "Two-factor authentication"
          : isSignIn
            ? "Sign in"
            : "Initial setup"}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        {needs2fa
          ? "Confirm it’s you with an authenticator or backup code"
          : isSignIn
            ? "Access your hosting control panel"
            : "Create the admin account"}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {needs2fa ? (
          <>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="123456 or backup code"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-white tracking-widest"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
            />
            <button
              type="button"
              onClick={() => {
                setNeeds2fa(false);
                setTotpCode("");
                setInfo("");
                setError("");
              }}
              className="text-sm text-slate-400 hover:text-white"
            >
              ← Back to password
            </button>
          </>
        ) : (
          <>
            {!isSignIn && (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
                  required
                />
                {installedDomain ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-300">
                    Server domain{" "}
                    <span className="font-mono text-emerald-400">{installedDomain}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      From install · primary host{" "}
                      <span className="font-mono">
                        {primaryHostname || `s1.${installedDomain}`}
                      </span>
                    </span>
                  </p>
                ) : (
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
                        {primaryHostname || `s1.${domain.trim() || "yourdomain"}`}
                      </span>
                    </p>
                  </div>
                )}
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
              {isSignIn ? (
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
          </>
        )}
        {info && <p className="text-sm text-emerald-400">{info}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {needs2fa
            ? "Verify"
            : isSignIn
              ? "Sign in"
              : "Create admin account"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-slate-950 px-4 py-8">
      <div className="fixed right-4 top-4 z-20">
        <ThemeToggle className="px-2.5 sm:px-3" />
      </div>
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
