"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { matchesSearch } from "@/lib/utils";

type CronJob = {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  user?: { email: string };
};

const PRESETS: { label: string; value: string }[] = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Weekly (Sunday)", value: "0 0 * * 0" },
  { label: "Monthly (1st)", value: "0 0 1 * *" },
  { label: "Custom", value: "custom" },
];

function presetFor(schedule: string) {
  return PRESETS.find((p) => p.value === schedule)?.value ?? "custom";
}

export default function CronPage() {
  const { confirm } = useAlert();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CronJob | null>(null);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("0 0 * * *");
  const [schedule, setSchedule] = useState("0 0 * * *");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/cron");
    const data = await res.json();
    setJobs(data.jobs ?? []);
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  function openCreate() {
    setEditing(null);
    setName("");
    setPreset("0 0 * * *");
    setSchedule("0 0 * * *");
    setCommand("");
    setError("");
    setOpen(true);
  }

  function openEdit(job: CronJob) {
    setEditing(job);
    setName(job.name);
    setPreset(presetFor(job.schedule));
    setSchedule(job.schedule);
    setCommand(job.command);
    setError("");
    setOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const body = {
        name,
        schedule: preset === "custom" ? schedule : preset,
        command,
      };
      const res = await fetch("/api/cron", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Failed to save cron job"
        );
        return;
      }
      setOpen(false);
      await loadJobs();
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(job: CronJob) {
    await fetch("/api/cron", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id, enabled: !job.enabled }),
    });
    await loadJobs();
  }

  async function handleDelete(id: string) {
    const ok = await confirm("Delete this cron job?", {
      title: "Delete cron job",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await fetch(`/api/cron?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadJobs();
  }

  const filtered = jobs.filter((job) =>
    matchesSearch(search, job.name, job.schedule, job.command, job.user?.email)
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cron Jobs"
        description="Schedule commands on the server (Linux crontab)."
        actionLabel="Add Cron Job"
        onAction={openCreate}
        actionIcon={<Clock className="h-4 w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search cron jobs..."
      />

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
        <p>
          Jobs are written to <span className="font-mono text-xs">/etc/cron.d/naviyra-jobs</span>.
          Use five fields: minute, hour, day, month, weekday.
        </p>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit cron job" : "Add cron job"}
        description="The command runs as the panel cron user on the VPS."
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Name</label>
            <input
              className={modalInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              placeholder="Daily backup script"
            />
          </div>
          <div>
            <label className={modalLabelClass}>Schedule</label>
            <Select
              value={preset}
              onChange={(value) => {
                setPreset(value);
                if (value !== "custom") setSchedule(value);
              }}
              options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            />
          </div>
          {preset === "custom" ? (
            <div>
              <label className={modalLabelClass}>Custom expression</label>
              <input
                className={modalInputClass}
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                required
                placeholder="*/15 * * * *"
              />
            </div>
          ) : null}
          <div>
            <label className={modalLabelClass}>Command</label>
            <input
              className={modalInputClass}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              required
              maxLength={500}
              placeholder="/usr/bin/php /var/www/example.com/cron.php"
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <ModalActions
            onCancel={() => setOpen(false)}
            submitLabel={saving ? "Saving…" : editing ? "Save" : "Create"}
          />
        </form>
      </Modal>

      <div className="space-y-2">
        {filtered.map((job) => (
          <div
            key={job.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="font-medium text-white">
                {job.name}
                {!job.enabled ? (
                  <span className="ml-2 text-xs font-normal text-slate-500">Paused</span>
                ) : null}
              </p>
              <p className="truncate font-mono text-xs text-slate-500">
                {job.schedule} · {job.command}
              </p>
              {job.user?.email ? (
                <p className="text-xs text-slate-600">{job.user.email}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleEnabled(job)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                {job.enabled ? "Pause" : "Enable"}
              </button>
              <button
                type="button"
                onClick={() => openEdit(job)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(job.id)}
                className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {jobs.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No cron jobs yet. Click Add Cron Job to schedule a command.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No cron jobs match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
