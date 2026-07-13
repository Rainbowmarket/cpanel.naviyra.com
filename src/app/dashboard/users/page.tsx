"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { ModalActions, PageHeader } from "@/components/ui/page-header";
import { matchesSearch } from "@/lib/utils";

type PanelUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "RESELLER" | "USER";
  createdAt: string;
  _count: { domains: number };
};

const roleOptions = [
  { value: "USER", label: "User" },
  { value: "RESELLER", label: "Reseller" },
  { value: "ADMIN", label: "Admin" },
];

const roleStyles: Record<string, string> = {
  ADMIN: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  RESELLER: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  USER: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("USER");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    const res = await fetch("/api/users");
    if (res.status === 403) {
      router.replace("/dashboard");
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [router]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to create user");
      setSubmitting(false);
      return;
    }

    setName("");
    setEmail("");
    setPassword("");
    setRole("USER");
    setSubmitting(false);
    setCreateOpen(false);
    load();
  }

  async function handleDelete(id: string, userEmail: string) {
    if (!confirm(`Delete user ${userEmail}? Their domains will also be removed.`)) return;
    setDeletingId(id);
    const res = await fetch(`/api/users?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "Failed to delete user");
    }
    setDeletingId(null);
    load();
  }

  const filteredUsers = users.filter((u) =>
    matchesSearch(search, u.name, u.email, u.role, u._count.domains)
  );

  if (loading) {
    return <p className="text-slate-400">Loading users...</p>;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users"
        description="Create and manage panel login accounts."
        actionLabel="New User"
        onAction={() => setCreateOpen(true)}
        actionIcon={<UserPlus className="h-4 w-4" />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search users..."
      />

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setError("");
        }}
        title="New User"
        description="Create a new panel login account."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className={modalLabelClass}>Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className={modalInputClass}
              required
              minLength={2}
            />
          </div>
          <div>
            <label className={modalLabelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
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
            <label className={modalLabelClass}>Role</label>
            <Select
              value={role}
              onChange={setRole}
              options={roleOptions}
              placeholder="Role"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {typeof error === "string" ? error : "Invalid input"}
            </p>
          )}
          <ModalActions
            onCancel={() => setCreateOpen(false)}
            submitLabel="Create User"
            submitting={submitting}
          />
        </form>
      </Modal>

      <div className="space-y-3">
        {filteredUsers.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/80 px-5 py-4"
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-medium text-white">{u.name}</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${roleStyles[u.role]}`}
                >
                  {u.role}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{u.email}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {u._count.domains} domain{u._count.domains === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(u.id, u.email)}
              disabled={deletingId === u.id}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        ))}
        {users.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No users yet. Click New User to create one.
          </p>
        ) : filteredUsers.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/50 px-5 py-10 text-center text-slate-500">
            No users match your search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
