"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { matchesSearch } from "@/lib/utils";

type HostingTarget = { id: string; label: string; documentRoot: string };
type FtpAccount = { id: string; username: string; homeDir: string };
type FtpConnection = {
  host: string;
  port: number;
  passivePorts: string;
  protocol: string;
};

export default function FtpPage() {
  const { confirm } = useAlert();
  const [targets, setTargets] = useState<HostingTarget[]>([]);
  const [target, setTarget] = useState("");
  const [accounts, setAccounts] = useState<FtpAccount[]>([]);
  const [connection, setConnection] = useState<FtpConnection | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/ftp");
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    if (data.connection) setConnection(data.connection);
  }, []);

  useEffect(() => {
    fetch("/api/ftp/targets")
      .then((r) => r.json())
      .then((d) => {
        setTargets(d.targets ?? []);
        if (d.targets?.[0]) setTarget(d.targets[0].id);
      });
    loadAccounts();
  }, [loadAccounts]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await fetch("/api/ftp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Failed to create FTP account"
        );
        return;
      }
      setUsername("");
      setPassword("");
      setCreateOpen(false);
      await loadAccounts();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm("Delete this FTP account?", {
      title: "Delete FTP account",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await fetch(`/api/ftp?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadAccounts();
  }

  const filteredAccounts = accounts.filter((a) =>
    matchesSearch(search, a.username, a.homeDir)
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="FTP Server"
        description="Create FTP accounts for file uploads."
        actionLabel="Create FTP Account"
        onAction={() => {
          setError("");
          setCreateOpen(true);
        }}
        actionIcon={<Upload className="h-4 w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search FTP accounts..."
      />

      {connection ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
          <p className="font-medium text-white">Connection</p>
          <p className="mt-1 font-mono text-xs text-slate-400">
            Host: {connection.host} · Port: {connection.port} · Passive:{" "}
            {connection.passivePorts}
          </p>
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create FTP Account"
        description="Add an FTP user scoped to a domain or subdomain directory."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Domain / Subdomain</label>
            <Select
              value={target}
              onChange={setTarget}
              options={targets.map((t) => ({ value: t.id, label: t.label }))}
              placeholder="Choose domain or subdomain..."
            />
          </div>
          <div>
            <label className={modalLabelClass}>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ftp_user"
              className={modalInputClass}
              required
              pattern="[A-Za-z_][A-Za-z0-9_-]{2,31}"
            />
          </div>
          <div>
            <label className={modalLabelClass}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={modalInputClass}
              required
              minLength={8}
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            submitLabel={creating ? "Creating…" : "Create Account"}
          />
        </form>
      </Modal>

      <div className="space-y-2">
        {filteredAccounts.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="font-medium text-white">{a.username}</p>
              <p className="truncate font-mono text-xs text-slate-500">
                {a.homeDir}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(a.id)}
              className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
            >
              Delete
            </button>
          </div>
        ))}
        {accounts.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No FTP accounts yet. Click Create FTP Account to add one.
          </p>
        ) : filteredAccounts.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-5 py-8 text-center text-slate-500">
            No FTP accounts match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
