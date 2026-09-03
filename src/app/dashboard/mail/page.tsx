"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  Mail,
  ExternalLink,
  Power,
  Trash2,
  Forward,
  Shield,
  ListOrdered,
  ScrollText,
  Bug,
} from "lucide-react";
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
type MailAlias = {
  id: string;
  alias: string;
  forwardTo: string;
  domainId?: string;
  domainName?: string;
};
type MailDomainMeta = {
  id: string;
  domainId: string;
  catchAllTo: string | null;
  dkimSelector: string;
  spamFilterOn: boolean;
  domain: { id: string; name: string };
};
type QueueItem = {
  id: string;
  size: string;
  arrival: string;
  sender: string;
  recipients: string;
  status: string;
};

export default function MailPage() {
  const { alert, confirm } = useAlert();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filterDomainId, setFilterDomainId] = useState("");
  const [createDomainId, setCreateDomainId] = useState("");
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [aliases, setAliases] = useState<MailAlias[]>([]);
  const [mailDomains, setMailDomains] = useState<MailDomainMeta[]>([]);
  const [localPart, setLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [quotaMb, setQuotaMb] = useState(1024);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [aliasOpen, setAliasOpen] = useState(false);
  const [aliasLocal, setAliasLocal] = useState("");
  const [aliasForward, setAliasForward] = useState("");
  const [aliasDomainId, setAliasDomainId] = useState("");
  const [catchAllTo, setCatchAllTo] = useState("");
  const [usageById, setUsageById] = useState<Record<string, number>>({});
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mail");
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    setAliases(data.aliases ?? []);
    setMailDomains(data.mailDomains ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/domains")
      .then((r) => r.json())
      .then((d) => {
        const list = (d.domains ?? []) as Domain[];
        setDomains(list);
        setIsAdmin(d.role === "ADMIN");
        if (list[0]) {
          setCreateDomainId(list[0].id);
          setAliasDomainId(list[0].id);
        }
      });
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    for (const d of domains) {
      fetch("/api/mail/host-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: d.id }),
      }).catch(() => {});
    }
  }, [domains]);

  useEffect(() => {
    const meta = mailDomains.find((m) => m.domainId === filterDomainId);
    setCatchAllTo(meta?.catchAllTo ?? "");
  }, [filterDomainId, mailDomains]);

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
        quotaMb,
      }),
    });
    setLocalPart("");
    setPassword("");
    setCreateOpen(false);
    await loadAccounts();
  }

  async function handleCreateAlias(e: FormEvent) {
    e.preventDefault();
    if (!aliasDomainId) return;
    const res = await fetch("/api/mail/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId: aliasDomainId,
        localPart: aliasLocal,
        forwardTo: aliasForward,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(data.error ?? "Failed to create alias", {
        title: "Alias",
        tone: "danger",
      });
      return;
    }
    setAliasLocal("");
    setAliasForward("");
    setAliasOpen(false);
    await loadAccounts();
  }

  async function handleDeleteAlias(id: string, alias: string) {
    const ok = await confirm(`Delete alias ${alias}?`, {
      title: "Delete alias",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await fetch(`/api/mail/aliases?id=${id}`, { method: "DELETE" });
    await loadAccounts();
  }

  async function saveCatchAll() {
    if (!filterDomainId) {
      await alert("Select a domain first", { tone: "warning" });
      return;
    }
    const res = await fetch("/api/mail/catch-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId: filterDomainId,
        forwardTo: catchAllTo.trim() ? catchAllTo.trim() : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(data.error ?? "Failed to save catch-all", { tone: "danger" });
      return;
    }
    await loadAccounts();
    await alert("Catch-all updated", { tone: "success" });
  }

  async function setupDkim(domainId: string) {
    setLoading(`dkim-${domainId}`);
    const res = await fetch("/api/mail/dkim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId }),
    });
    setLoading(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(data.error ?? "DKIM setup failed", { tone: "danger" });
      return;
    }
    await loadAccounts();
    await alert("DKIM keys generated and DNS records queued", {
      tone: "success",
    });
  }

  async function refreshUsage(id: string) {
    const res = await fetch(`/api/mail/quota?id=${id}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.usage) {
      setUsageById((prev) => ({ ...prev, [id]: data.usage.usedMb }));
    }
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

  async function handleToggleActive(
    id: string,
    isActive: boolean,
    email: string
  ) {
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

  async function loadQueue() {
    const res = await fetch("/api/mail/queue");
    if (res.status === 403) return;
    const data = await res.json();
    setQueueItems(data.items ?? []);
  }

  async function loadLogs() {
    const res = await fetch("/api/mail/logs?lines=80");
    if (res.status === 403) return;
    const data = await res.json();
    setLogLines(data.lines ?? []);
  }

  async function installSpam() {
    const ok = await confirm(
      "Install Rspamd + ClamAV on the mail server? This may take several minutes.",
      { title: "Install spam protection", confirmLabel: "Install" }
    );
    if (!ok) return;
    setLoading("spam");
    const res = await fetch("/api/mail/spam", { method: "POST" });
    setLoading(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(data.error ?? "Install failed", { tone: "danger" });
      return;
    }
    await alert("Spam/antivirus stack install requested", { tone: "success" });
    await loadAccounts();
  }

  async function openMailbox(accountId: string) {
    setLoading(accountId);
    try {
      const res = await fetch(`/api/mail/sso?id=${accountId}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alert(
          typeof data.error === "string"
            ? data.error
            : "Could not open mailbox",
          { title: "Open mailbox", tone: "danger" }
        );
        return;
      }
      window.open(
        data.url ?? `/mailbox/${accountId}`,
        "_blank",
        "noopener,noreferrer"
      );
    } finally {
      setLoading(null);
    }
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

  const filteredAliases = aliases.filter((a) => {
    if (filterDomainId && a.domainId !== filterDomainId) return false;
    return matchesSearch(search, a.alias, a.forwardTo, a.domainName);
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mail Server"
        description="Mailboxes, aliases, catch-all, DKIM/DMARC, quotas, and admin queue tools."
        actionLabel="Create Mailbox"
        onAction={() => {
          if (!createDomainId && domains[0]) setCreateDomainId(domains[0].id);
          setCreateOpen(true);
        }}
        actionIcon={<Mail className="h-3.5 w-3.5" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search mailboxes..."
      />

      <div className="flex flex-wrap items-center gap-2">
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
        <button
          type="button"
          onClick={() => {
            if (!aliasDomainId && domains[0]) setAliasDomainId(domains[0].id);
            setAliasOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
        >
          <Forward className="h-3.5 w-3.5" />
          Add alias
        </button>
        {filterDomainId ? (
          <button
            type="button"
            onClick={() => void setupDkim(filterDomainId)}
            disabled={loading === `dkim-${filterDomainId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <Shield className="h-3.5 w-3.5" />
            Setup DKIM/DMARC
          </button>
        ) : null}
      </div>

      {filterDomainId ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
          <p className="text-sm font-medium text-white">Catch-all</p>
          <p className="mt-1 text-xs text-slate-500">
            Forward unknown addresses on this domain to a mailbox (or clear to
            disable).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={catchAllTo}
              onChange={(e) => setCatchAllTo(e.target.value)}
              placeholder="mailbox@domain.com"
              className="min-w-[16rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
            <button
              type="button"
              onClick={() => void saveCatchAll()}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-500"
            >
              Save catch-all
            </button>
          </div>
        </div>
      ) : null}

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
          <div>
            <label className={modalLabelClass}>Quota (MB)</label>
            <input
              type="number"
              min={1}
              value={quotaMb}
              onChange={(e) => setQuotaMb(Number(e.target.value) || 1024)}
              className={modalInputClass}
            />
          </div>
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            submitLabel="Create Mailbox"
          />
        </form>
      </Modal>

      <Modal
        open={aliasOpen}
        onClose={() => setAliasOpen(false)}
        title="Create Alias"
        description="Alias forwards to another mailbox or external address."
      >
        <form onSubmit={handleCreateAlias} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Domain</label>
            <Select
              value={aliasDomainId}
              onChange={setAliasDomainId}
              options={domains.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Choose domain..."
            />
          </div>
          <div>
            <label className={modalLabelClass}>Alias prefix</label>
            <input
              value={aliasLocal}
              onChange={(e) => setAliasLocal(e.target.value)}
              placeholder="support"
              className={modalInputClass}
              required
            />
          </div>
          <div>
            <label className={modalLabelClass}>Forward to</label>
            <input
              type="email"
              value={aliasForward}
              onChange={(e) => setAliasForward(e.target.value)}
              placeholder="user@example.com"
              className={modalInputClass}
              required
            />
          </div>
          <ModalActions
            onCancel={() => setAliasOpen(false)}
            submitLabel="Create Alias"
          />
        </form>
      </Modal>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Mailboxes</h2>
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
                <p className="mt-1 text-sm text-slate-400">
                  {usageById[a.id] != null
                    ? `${usageById[a.id]} / ${a.quotaMb} MB used`
                    : `${a.quotaMb} MB quota`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshUsage(a.id)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Refresh usage
                </button>
                <button
                  type="button"
                  onClick={() => void openMailbox(a.id)}
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
                  {a.isActive
                    ? "Deactivate"
                    : a.lockedAt
                      ? "Unlock / Activate"
                      : "Activate"}
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

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Aliases</h2>
        {filteredAliases.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 px-5 py-3"
          >
            <div>
              <p className="font-medium text-white">{a.alias}</p>
              <p className="text-sm text-slate-400">→ {a.forwardTo}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleDeleteAlias(a.id, a.alias)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        ))}
        {filteredAliases.length === 0 ? (
          <p className="text-sm text-slate-500">No aliases yet.</p>
        ) : null}
      </div>

      {isAdmin ? (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/80 p-5">
          <h2 className="text-sm font-semibold text-white">Admin mail ops</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              <ListOrdered className="h-3.5 w-3.5" />
              Refresh queue
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/mail/queue", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "flush" }),
                });
                await loadQueue();
              }}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              Flush queue
            </button>
            <button
              type="button"
              onClick={() => void loadLogs()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              <ScrollText className="h-3.5 w-3.5" />
              Tail mail log
            </button>
            <button
              type="button"
              onClick={() => void installSpam()}
              disabled={loading === "spam"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
            >
              <Bug className="h-3.5 w-3.5" />
              {loading === "spam" ? "Installing…" : "Install Rspamd + ClamAV"}
            </button>
          </div>

          {queueItems.length > 0 ? (
            <div className="space-y-2">
              {queueItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs"
                >
                  <div className="text-slate-300">
                    <span className="font-mono text-white">{item.id}</span> ·{" "}
                    {item.status} · {item.sender} → {item.recipients}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
                      onClick={async () => {
                        await fetch("/api/mail/queue", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "flush",
                            id: item.id,
                          }),
                        });
                        await loadQueue();
                      }}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-500/30 px-2 py-1 text-red-400 hover:bg-red-500/10"
                      onClick={async () => {
                        await fetch("/api/mail/queue", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "delete",
                            id: item.id,
                          }),
                        });
                        await loadQueue();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Queue empty or not loaded yet.
            </p>
          )}

          {logLines.length > 0 ? (
            <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-slate-400">
              {logLines.join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
