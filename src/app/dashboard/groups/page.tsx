"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, UsersRound } from "lucide-react";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { useAlert } from "@/components/ui/alert-provider";
import { matchesSearch } from "@/lib/utils";
import { PANEL_PERMISSION_CATALOG, PANEL_PERMISSION_KEYS } from "@/lib/panel-permissions";

type GroupUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type PermissionGroup = {
  id: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  members: GroupUser[];
};

const emptyForm = {
  name: "",
  description: "",
  permissionKeys: [] as string[],
  userIds: [] as string[],
};

export default function GroupsPage() {
  const router = useRouter();
  const { alert, confirm } = useAlert();
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [users, setUsers] = useState<GroupUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PermissionGroup | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/groups");
    if (res.status === 403) {
      router.replace("/dashboard");
      return;
    }
    const data = await res.json();
    setGroups(data.groups ?? []);
    setUsers(data.users ?? []);
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

  function openEdit(group: PermissionGroup) {
    setEditing(group);
    setForm({
      name: group.name,
      description: group.description ?? "",
      permissionKeys: [...group.permissionKeys],
      userIds: group.members.map((member) => member.id),
    });
    setError("");
    setFormOpen(true);
  }

  function toggleKey(key: string) {
    setForm((current) => {
      if (key === "admin") {
        const enabling = !current.permissionKeys.includes("admin");
        return {
          ...current,
          permissionKeys: enabling ? [...PANEL_PERMISSION_KEYS] : [],
        };
      }
      const next = current.permissionKeys.includes(key)
        ? current.permissionKeys.filter((item) => item !== key)
        : [...current.permissionKeys, key];
      return {
        ...current,
        permissionKeys: next.filter((item) => item !== "admin"),
      };
    });
  }

  function toggleUser(id: string) {
    setForm((current) => ({
      ...current,
      userIds: current.userIds.includes(id)
        ? current.userIds.filter((item) => item !== id)
        : [...current.userIds, id],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/groups", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        description: form.description,
        permissionKeys: form.permissionKeys,
        userIds: form.userIds,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(
        typeof data.error === "string" ? data.error : "Failed to save group"
      );
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setFormOpen(false);
    load();
  }

  async function handleDelete(group: PermissionGroup) {
    const ok = await confirm(
      `Delete group “${group.name}”? Members keep their accounts but lose this group’s permissions.`,
      { title: "Delete group", danger: true, confirmLabel: "Delete" }
    );
    if (!ok) return;
    setDeletingId(group.id);
    const res = await fetch(`/api/groups?id=${group.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(data.error ?? "Failed to delete group", {
        title: "Could not delete",
        tone: "danger",
      });
    }
    setDeletingId(null);
    load();
  }

  const filtered = groups.filter((group) =>
    matchesSearch(search, group.name, group.description ?? "", ...group.members.map((m) => m.email))
  );

  if (loading) {
    return <p className="text-sm text-slate-400">Loading groups…</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups"
        description="Create permission groups and assign users to panel features."
        actionLabel="New Group"
        onAction={openCreate}
        actionIcon={<UsersRound className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search groups..."
      />

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Group" : "New Group"}
        description="Check Administrator for a full admin group, or pick individual features. Assign regular users as members — they receive those permissions immediately."
        className="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className={modalLabelClass}>Group name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
              placeholder="Support staff"
              className={modalInputClass}
              required
              minLength={2}
            />
          </div>
          <div>
            <label className={modalLabelClass}>Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
              placeholder="Optional"
              className={modalInputClass}
            />
          </div>
          <div>
            <p className={modalLabelClass}>Permissions</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PANEL_PERMISSION_CATALOG.map((item) => {
                const checked = form.permissionKeys.includes(item.key);
                const isAdminGrant = item.key === "admin";
                return (
                  <label
                    key={item.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:border-slate-700 ${
                      isAdminGrant
                        ? "border-emerald-500/40 bg-emerald-500/5 sm:col-span-2"
                        : "border-slate-800 bg-slate-950/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleKey(item.key)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-white">{item.label}</span>
                      <span className="block text-xs text-slate-500">{item.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <p className={modalLabelClass}>Members</p>
            {users.length === 0 ? (
              <p className="text-sm text-slate-500">
                No non-admin users yet. Create users first, then add them here.
              </p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={form.userIds.includes(user.id)}
                      onChange={() => toggleUser(user.id)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{user.name}</span>
                      <span className="block truncate text-xs text-slate-500">{user.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {error ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <ModalActions
            onCancel={() => setFormOpen(false)}
            submitLabel={editing ? "Save Group" : "Create Group"}
            submitting={submitting}
          />
        </form>
      </Modal>

      <div className="space-y-3">
        {filtered.map((group) => (
          <div
            key={group.id}
            className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/80 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white">{group.name}</p>
              {group.description ? (
                <p className="mt-1 text-sm text-slate-400">{group.description}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {group.permissionKeys.length === 0 ? (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                    No features
                  </span>
                ) : (
                  group.permissionKeys.map((key) => {
                    const label =
                      PANEL_PERMISSION_CATALOG.find((item) => item.key === key)?.label ?? key;
                    const isAdminGrant = key === "admin";
                    return (
                      <span
                        key={key}
                        className={
                          isAdminGrant
                            ? "rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-200 ring-1 ring-emerald-400/40"
                            : "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 ring-1 ring-emerald-500/20"
                        }
                      >
                        {label}
                      </span>
                    );
                  })
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {group.members.length === 0
                  ? "No members"
                  : group.members.map((member) => member.name).join(", ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openEdit(group)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(group)}
                disabled={deletingId === group.id}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No groups yet. Click New Group to create one and assign permissions.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No groups match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
