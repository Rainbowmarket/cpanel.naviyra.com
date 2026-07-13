"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [isSetup, setIsSetup] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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

    const res = await fetch("/api/auth/login", {
      method: isSetup ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isSetup ? { email, password } : { name, email, password }
      ),
    });

    if (!res.ok) {
      setError(isSetup ? "Invalid credentials" : "Setup failed");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-slate-950 px-4 py-8">
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
            : "Create the first admin account"}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {!isSetup && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
              required
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white"
            required
            minLength={8}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-500"
          >
            {isSetup ? "Sign in" : "Create admin & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
