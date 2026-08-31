"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Share2, Trash2 } from "lucide-react";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { matchesSearch } from "@/lib/utils";

type CatalogItem = {
  key: string;
  label: string;
  description: string;
};

type DomainOption = {
  id: string;
  name: string;
  user: { id: string; email: string; name: string };
};

type UserOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type Grant = {
  id: string;
  domainId: string;
  userId: string;
  domain: { id: string; name: string };
  user: { id: string; name: string; email: string; role: string };
  permissions: string[];
  createdAt: string;
  updatedAt: string;
};

const emptyForm = {
  domainId: "",
  userId: "",
  permissions: [] as string[],
};

export default function DomainAccessPage() {
  const router = useRouter();
  const { alert, confirm } = useAlert();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Grant | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    const [grantsRes, formRes] = await Promise.all([
      fetch("/api/domain-access"),
      fetch("/api/domain-access?form=1"),
    ]);
    if (grantsRes.status === 403 || formRes.status === 403) {
      router.replace("/dashboard");
      return;
    }
    const grantsData = await grantsRes.json();
    const formData = await formRes.json();
    setGrants(grantsData.grants ?? []);
    setDomains(formData.domains ?? []);
    setUsers(formData.users ?? []);
    setCatalog(formData.permissionCatalog ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [router]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setFormOpen(true);
  }

  function openEdit(grant: Grant) {
    setEditing(grant);
    setForm({
      domainId: grant.domainId,
      userId: grant.userId,
      permissions: [...grant.permissions],
    });
    setError("");
    setFormOpen(true);
  }

  function toggleKey(key: string) {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(key)
        ? current.permissions.filter((item) => item !== key)
        : [...current.permissions, key],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const res = editing
      ? await fetch(`/api/domain-access/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: form.permissions }),
        })
      : await fetch("/api/domain-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domainId: form.domainId,
            userId: form.userId,
            permissions: form.permissions,
          }),
        });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(
        typeof data.error === "string" ? data.error : "Failed to save grant"
      );
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setFormOpen(false);
    load();
  }

  async function handleDelete(grant: Grant) {
    const ok = await confirm(
      `Revoke access for ${grant.user.email} on ${grant.domain.name}? Ownership of the domain is unchanged.`,
      { title: "Revoke domain access", danger: true, confirmLabel: "Revoke" }
    );
    if (!ok) return;
    setDeletingId(grant.id);
    const res = await fetch(`/api/domain-access/${grant.id}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(data.error ?? "Failed to revoke grant", {
        title: "Could not revoke",
        tone: "danger",
      });
    }
    setDeletingId(null);
    load();
  }

  const filtered = grants.filter((grant) =>
    matchesSearch(
      search,
      grant.domain.name,
      grant.user.email,
      grant.user.name,
      ...grant.permissions
    )
  );

  if (loading) {
    return <p className="text-sm text-slate-400">Loading domain access…</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Domain Access"
        description="Grant an existing domain to a user with specific features. Does not duplicate domains or change ownership."
        actionLabel="Grant Access"
        onAction={openCreate}
        actionIcon={<Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search grants..."
      />

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Domain Access" : "Grant Domain Access"}
        description="Pick an existing domain and a regular user, then choose which features they may use. Domain.userId (owner) stays the same."
        className="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className={modalLabelClass}>Domain</label>
            <select
              value={form.domainId}
              onChange={(e) =>
                setForm((c) => ({ ...c, domainId: e.target.value }))
              }
              className={modalInputClass}
              required
              disabled={Boolean(editing)}
            >
              <option value="">Select domain…</option>
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name} (owner: {domain.user.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>User</label>
            <select
              value={form.userId}
              onChange={(e) =>
                setForm((c) => ({ ...c, userId: e.target.value }))
              }
              className={modalInputClass}
              required
              disabled={Boolean(editing)}
            >
              <option value="">Select user…</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className={modalLabelClass}>Permissions</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {catalog.map((item) => {
                const checked = form.permissions.includes(item.key);
                return (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5 hover:border-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleKey(item.key)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-white">
                        {item.label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {item.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          {error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <ModalActions
            onCancel={() => setFormOpen(false)}
            submitLabel={editing ? "Save Permissions" : "Grant Access"}
            submitting={submitting}
          />
        </form>
      </Modal>

      <div className="space-y-3">
        {filtered.map((grant) => (
          <div
            key={grant.id}
            className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/80 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white">{grant.domain.name}</p>
              <p className="mt-1 text-sm text-slate-400">
                Shared with {grant.user.name} ({grant.user.email})
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {grant.permissions.map((key) => {
                  const label =
                    catalog.find((item) => item.key === key)?.label ?? key;
                  return (
                    <span
                      key={key}
                      className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openEdit(grant)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(grant)}
                disabled={deletingId === grant.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingId === grant.id ? "Revoking…" : "Revoke"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800 px-5 py-8 text-center text-sm text-slate-500">
            No domain access grants yet. Use Grant Access to share an existing
            domain without changing ownership.
          </p>
        ) : null}
      </div>
    </div>
  );
}
