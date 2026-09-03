"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";

type ServerConfig = {
  id: string;
  maxUploadMb: number;
  nginxApplied: boolean;
  lastError: string | null;
  updatedAt: string;
};

const PRESETS = [64, 128, 256, 512, 1024];

export default function SettingsPage() {
  const router = useRouter();
  const { alert } = useAlert();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [maxUploadMb, setMaxUploadMb] = useState(512);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/settings");
    if (res.status === 403) {
      router.replace("/dashboard");
      return;
    }
    const data = await res.json();
    const next = data.config as ServerConfig | undefined;
    if (next) {
      setConfig(next);
      setMaxUploadMb(next.maxUploadMb);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [router]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxUploadMb }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : "Could not save upload limit.";
        setError(message);
        return;
      }
      setConfig(data.config);
      setMaxUploadMb(data.config.maxUploadMb);
      await alert(
        data.config.nginxApplied
          ? `File Manager uploads can be up to ${data.config.maxUploadMb} MB.`
          : `Saved ${data.config.maxUploadMb} MB. ${data.config.lastError || "Reload nginx on the server if uploads still fail with 413."}`,
        { title: "Saved" }
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Server-wide File Manager and nginx upload limit."
      />

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <form
          onSubmit={handleSave}
          className="max-w-xl space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-5"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-emerald-500/15 p-2 text-emerald-300">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Max upload size</h3>
              <p className="mt-1 text-sm text-slate-400">
                Applies to File Manager (ZIP extract included) and nginx{" "}
                <code className="text-slate-300">client_max_body_size</code>. Default
                nginx is 1 MB, which returns 413 for larger files.
              </p>
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Megabytes (1–2048)
            </span>
            <input
              type="number"
              min={1}
              max={2048}
              value={maxUploadMb}
              onChange={(e) => setMaxUploadMb(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-emerald-500/40 focus:ring-2"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((mb) => (
              <button
                key={mb}
                type="button"
                onClick={() => setMaxUploadMb(mb)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  maxUploadMb === mb
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                    : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                }`}
              >
                {mb} MB
              </button>
            ))}
          </div>

          {config?.nginxApplied ? (
            <p className="text-xs text-emerald-400">
              nginx is using {config.maxUploadMb} MB.
            </p>
          ) : config?.lastError ? (
            <p className="text-xs text-amber-400">{config.lastError}</p>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save and apply"}
          </button>
        </form>
      )}
    </div>
  );
}
