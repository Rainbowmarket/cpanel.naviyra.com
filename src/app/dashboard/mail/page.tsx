"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { KeyRound, Mail, ExternalLink, Power, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { matchesSearch } from "@/lib/utils";

type Domain = { id: string; name: string };
type MailAccount = {
  id: string;
  email: string;
  quotaMb: number;
  isActive: boolean;
  lockedAt?: string | null;
  domainId?: string;
  domainName?: string;
};

export default function MailPage() {
  const { alert, confirm } = useAlert();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [filterDomainId, setFilterDomainId] = useState("");
  const [createDomainId, setCreateDomainId] = useState("");
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [localPart, setLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mail");
    const data = await res.json();
    setAccounts(data.accounts ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/domains")
      .then((r) => r.json())
      .then((d) => {
        const list = (d.domains ?? []) as Domain[];
        setDomains(list);
        if (list[0]) setCreateDomainId(list[0].id);
      });
    loadAccounts();
  }, [loadAccounts]);

  // Ensure mail host DNS/SSL for every domain once loaded
  useEffect(() => {
    for (const d of domains) {
      fetch("/api/mail/host-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: d.id }),
      }).catch(() => {});
    }
  }, [domains]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!createDomainId) return;
    await fetch("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId: createDomainId,
        localPart,
        password,
      }),
    });
    setLocalPart("");
    setPassword("");
    setCreateOpen(false);
    await loadAccounts();
  }

  async function handleDelete(id: string, email: string) {
    const ok = await confirm(`Delete mailbox ${email}?`, {
      title: "Delete mailbox",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setLoading(id);
    await fetch(`/api/mail?id=${id}`, { method: "DELETE" });
    setLoading(null);
    await loadAccounts();
  }

  async function handleResetPassword(id: string) {
    if (!newPassword || newPassword.length < 8) {
      await alert("Password must be at least 8 characters", {
        title: "Invalid password",
        tone: "warning",
      });
      return;
    }
    setLoading(id);
    await fetch(`/api/mail?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_password", password: newPassword }),
    });
    setLoading(null);
    setResettingId(null);
    setNewPassword("");
    await loadAccounts();
  }

  async function handleToggleActive(id: string, isActive: boolean, email: string) {
    const action = isActive ? "deactivate" : "activate";
    const ok = await confirm(`${action} mailbox ${email}?`, {
      title: isActive ? "Deactivate mailbox" : "Activate mailbox",
      tone: isActive ? "warning" : "info",
      confirmLabel: isActive ? "Deactivate" : "Activate",
    });
    if (!ok) return;
    setLoading(id);
    await fetch(`/api/mail?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_active", isActive: !isActive }),
    });
    setLoading(null);
    await loadAccounts();
  }

  function openMailbox(accountId: string) {
    window.open(`/mailbox/${accountId}`, "_blank", "noopener,noreferrer");
  }

  function openCreate() {
    if (!createDomainId && domains[0]) setCreateDomainId(domains[0].id);
    setCreateOpen(true);
  }

  const filteredAccounts = accounts.filter((a) => {
    if (filterDomainId && a.domainId !== filterDomainId) return false;
    return matchesSearch(
      search,
      a.email,
      a.domainName,
      a.isActive ? "active" : "deactivated",
      a.quotaMb
    );
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mail Server"
        description="Manage email accounts for all domains."
        actionLabel="Create Mailbox"
        onAction={openCreate}
        actionIcon={<Mail className="h-3.5 w-3.5" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search mailboxes..."
      />

      <div className="flex items-center gap-2">
        <label className="shrink-0 text-xs font-medium text-slate-400">
          Domain
        </label>
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <Select
            value={filterDomainId}
            onChange={setFilterDomainId}
            options={[
              { value: "", label: "All domains" },
              ...domains.map((d) => ({ value: d.id, label: d.name })),
            ]}
            placeholder="All domains"
          />
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Mailbox"
        description="Add a new email account for a domain."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Domain</label>
            <Select
              value={createDomainId}
              onChange={setCreateDomainId}
              options={domains.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Choose domain..."
            />
          </div>
          <div>
            <label className={modalLabelClass}>Email prefix</label>
            <input
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              placeholder="info"
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
              placeholder="Min 8 characters"
              className={modalInputClass}
              required
              minLength={8}
            />
          </div>
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            submitLabel="Create Mailbox"
          />
        </form>
      </Modal>

      <div className="space-y-3">
        {filteredAccounts.map((a) => (
          <div
            key={a.id}
            className="rounded-xl border border-slate-800 bg-slate-950/80 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-white">{a.email}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                      a.isActive
                        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                        : a.lockedAt
                          ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                          : "bg-slate-500/15 text-slate-400 ring-slate-500/30"
                    }`}
                  >
                    {a.isActive
                      ? "Active"
                      : a.lockedAt
                        ? "Locked (failed logins)"
                        : "Deactivated"}
                  </span>
                  {a.domainName ? (
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300 ring-1 ring-slate-700">
                      {a.domainName}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-400">{a.quotaMb} MB quota</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openMailbox(a.id)}
                  disabled={!a.isActive || loading === a.id}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open mailbox
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResettingId(resettingId === a.id ? null : a.id);
                    setNewPassword("");
                  }}
                  disabled={loading === a.id}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Reset password
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleActive(a.id, a.isActive, a.email)}
                  disabled={loading === a.id}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50 ${
                    a.isActive
                      ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                      : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  }`}
                >
                  <Power className="h-3.5 w-3.5" />
                  {a.isActive ? "Deactivate" : a.lockedAt ? "Unlock / Activate" : "Activate"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id, a.email)}
                  disabled={loading === a.id}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>

            {resettingId === a.id && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min 8 chars)"
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => handleResetPassword(a.id)}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-500"
                >
                  Save password
                </button>
                <button
                  type="button"
                  onClick={() => setResettingId(null)}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
        {accounts.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No mail accounts yet. Click Create Mailbox to add one.
          </p>
        ) : filteredAccounts.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No mailboxes match your filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}
