"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

type Status = {
  enabled: boolean;
  setupPending: boolean;
  unusedBackupCodes: number;
};

export default function AccountSecurityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [regenPassword, setRegenPassword] = useState("");
  const [regenTotp, setRegenTotp] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/auth/2fa/status");
    const data = await res.json();
    if (res.ok) setStatus(data);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function startSetup() {
    setError("");
    setInfo("");
    setBackupCodes(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Setup failed");
        return;
      }
      setQrDataUrl(data.qrDataUrl ?? "");
      setOtpauthUrl(data.otpauthUrl ?? "");
      setConfirmCode("");
      setInfo("Scan the QR code, then enter a 6-digit code to confirm.");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: confirmCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Confirm failed");
        return;
      }
      setBackupCodes(data.backupCodes ?? []);
      setQrDataUrl("");
      setOtpauthUrl("");
      setConfirmCode("");
      setInfo("Two-factor authentication is enabled. Save your backup codes now.");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function disable2fa(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Disable failed");
        return;
      }
      setDisablePassword("");
      setBackupCodes(null);
      setQrDataUrl("");
      setInfo("Two-factor authentication disabled.");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/backup-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: regenPassword || undefined,
          totpCode: regenTotp || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Regenerate failed"
        );
        return;
      }
      setBackupCodes(data.backupCodes ?? []);
      setRegenPassword("");
      setRegenTotp("");
      setInfo("New backup codes generated. Old codes no longer work.");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account security"
        description="Optional authenticator app (TOTP) for panel login — Google Authenticator, Authy, 1Password, etc."
      />

      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Two-factor authentication
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {status == null
                  ? "Loading…"
                  : status.enabled
                    ? `Enabled · ${status.unusedBackupCodes} unused backup code(s)`
                    : "Disabled — password only"}
              </p>
            </div>
          </div>
          {status && !status.enabled ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startSetup()}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              Enable 2FA
            </button>
          ) : null}
        </div>

        {info ? <p className="mt-4 text-sm text-emerald-400">{info}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

        {qrDataUrl ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-[auto_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="2FA QR code"
              className="h-[220px] w-[220px] rounded-xl border border-slate-800 bg-white p-2"
            />
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Scan with your authenticator app. If you cannot scan, add this
                key manually from the otpauth URL (advanced).
              </p>
              {otpauthUrl ? (
                <p className="break-all font-mono text-[10px] text-slate-500">
                  {otpauthUrl}
                </p>
              ) : null}
              <form onSubmit={confirmSetup} className="flex flex-wrap gap-2">
                <input
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="6-digit code"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-white"
                  required
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  Confirm &amp; enable
                </button>
              </form>
            </div>
          </div>
        ) : null}

        {backupCodes ? (
          <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-sm font-medium text-amber-200">
              Save these backup codes — shown once
            </p>
            <ul className="mt-3 grid gap-1 font-mono text-sm text-amber-100 sm:grid-cols-2">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {status?.enabled ? (
        <>
          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-white">
                Regenerate backup codes
              </h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Enter your password or a current authenticator code. This
              invalidates previous backup codes.
            </p>
            <form onSubmit={regenerate} className="flex flex-wrap gap-2">
              <input
                type="password"
                value={regenPassword}
                onChange={(e) => setRegenPassword(e.target.value)}
                placeholder="Password"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              />
              <input
                value={regenTotp}
                onChange={(e) => setRegenTotp(e.target.value)}
                placeholder="Or 6-digit TOTP"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-white"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-60"
              >
                Regenerate
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <h2 className="text-sm font-semibold text-white">Disable 2FA</h2>
            <p className="mt-1 text-xs text-slate-500">
              Requires your account password.
            </p>
            <form onSubmit={disable2fa} className="mt-3 flex flex-wrap gap-2">
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Current password"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-60"
              >
                Disable 2FA
              </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
