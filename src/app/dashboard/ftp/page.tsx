"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { matchesSearch } from "@/lib/utils";

type HostingTarget = { id: string; label: string; documentRoot: string };
type FtpAccount = { id: string; username: string; homeDir: string };

export default function FtpPage() {
  const [targets, setTargets] = useState<HostingTarget[]>([]);
  const [target, setTarget] = useState("");
  const [accounts, setAccounts] = useState<FtpAccount[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/ftp");
    const data = await res.json();
    setAccounts(data.accounts ?? []);
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
    await fetch("/api/ftp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, username, password }),
    });
    setUsername("");
    setPassword("");
    setCreateOpen(false);
    await loadAccounts();
  }

  const filteredAccounts = accounts.filter((a) =>
    matchesSearch(search, a.username, a.homeDir)
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="FTP Server"
        description="Create FTP accounts for file uploads."
        actionLabel="Create FTP Account"
        onAction={() => setCreateOpen(true)}
        actionIcon={<Upload className="h-4 w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search FTP accounts..."
      />

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
            />
          </div>
          <div>
            <label className={modalLabelClass}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={modalInputClass}
              required
            />
          </div>
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            submitLabel="Create Account"
          />
        </form>
      </Modal>

      <div className="space-y-2">
        {filteredAccounts.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3"
          >
            <p className="font-medium text-white">{a.username}</p>
            <p className="text-sm text-slate-400">{a.homeDir}</p>
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
