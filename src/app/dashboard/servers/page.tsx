"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Puzzle, Radio, Server, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Modal, modalInputClass, modalLabelClass } from "@/components/ui/modal";
import { useAlert } from "@/components/ui/alert-provider";

type FleetServer = {
  id: string;
  name: string;
  hostname: string;
  ipAddress: string;
  agentUrl: string | null;
  notes: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  lastPingError: string | null;
  domainCount: number;
  agentKeyHint: string;
};

type NodePlugin = {
  pluginId: string;
  name: string;
  kind: string;
  installed: boolean;
  health: string | null;
};

type PluginActionResult = {
  op: "health" | "install";
  ok: boolean;
  message: string;
};

function formatPluginError(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      /* ignore */
    }
  }
  return "Plugin action failed";
}

function readPluginPayload(body: Record<string, unknown>): {
  ok: boolean;
  message: string;
} {
  const nested = body.data;
  const payload =
    nested && typeof nested === "object"
      ? (nested as { ok?: boolean; detail?: string; error?: string })
      : null;
  const detail =
    (typeof payload?.detail === "string" && payload.detail.trim()) ||
    (typeof payload?.error === "string" && payload.error.trim()) ||
    "";
  return {
    ok: payload?.ok === true,
    message: detail,
  };
}

const emptyForm = {
  name: "",
  hostname: "",
  ipAddress: "",
  agentUrl: "",
  agentKey: "",
  notes: "",
};

export default function ServersPage() {
  const { confirm, alert } = useAlert();
  const [servers, setServers] = useState<FleetServer[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FleetServer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [pinging, setPinging] = useState("");
  const [pluginServerId, setPluginServerId] = useState("");
  const [plugins, setPlugins] = useState<NodePlugin[]>([]);
  const [pluginsError, setPluginsError] = useState("");
  const [pluginBusy, setPluginBusy] = useState("");
  const [pluginResults, setPluginResults] = useState<
    Record<string, PluginActionResult>
  >({});

  const load = useCallback(async () => {
    const res = await fetch("/api/servers");
    const data = await res.json();
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to load servers");
      return;
    }
    setError("");
    setServers(data.servers ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(server: FleetServer) {
    setEditing(server);
    setForm({
      name: server.name,
      hostname: server.hostname,
      ipAddress: server.ipAddress,
      agentUrl: server.agentUrl ?? "",
      agentKey: "",
      notes: server.notes ?? "",
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
  }

  async function saveServer(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/servers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? {
                id: editing.id,
                name: form.name,
                hostname: form.hostname,
                ipAddress: form.ipAddress,
                agentUrl: form.agentUrl,
                agentKey: form.agentKey,
                notes: form.notes,
              }
            : form
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        await alert(
          typeof data.error === "string"
            ? data.error
            : editing
              ? "Could not update server"
              : "Could not add server",
          { title: "Servers", tone: "danger" }
        );
        return;
      }
      closeModal();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function ping(id: string) {
    setPinging(id);
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "ping", id }),
      });
      const data = await res.json();
      if (!res.ok) {
        await alert(typeof data.error === "string" ? data.error : "Ping failed", {
          title: "Agent ping",
        });
      }
      await load();
    } finally {
      setPinging("");
    }
  }

  async function remove(server: FleetServer) {
    const ok = await confirm(
      `Remove ${server.name} (${server.hostname}) from the fleet? Domains must already be empty.`,
      { title: "Remove server", danger: true, confirmLabel: "Remove" }
    );
    if (!ok) return;
    const res = await fetch(`/api/servers?id=${encodeURIComponent(server.id)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await alert(typeof data.error === "string" ? data.error : "Delete failed", {
        title: "Servers",
      });
      return;
    }
    await load();
  }

  async function loadPlugins(serverId: string) {
    setPluginServerId(serverId);
    setPluginsError("");
    if (serverId !== pluginServerId) setPluginResults({});
    const res = await fetch(`/api/plugins?serverId=${encodeURIComponent(serverId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPlugins([]);
      setPluginsError(typeof data.error === "string" ? data.error : "Could not list plugins");
      return;
    }
    setPlugins(data.plugins ?? []);
  }

  async function runPlugin(plugin: NodePlugin, op: "health" | "install") {
    if (!pluginServerId) return;

    if (op === "install") {
      const ok = await confirm(
        `${plugin.name} will be installed on this server (apt/dnf as root). This can take several minutes. When it succeeds, use it from Databases, Apps, Mail, or the matching panel page.`,
        {
          title: `Install ${plugin.name}?`,
          confirmLabel: "Install on server",
          tone: "warning",
        }
      );
      if (!ok) return;
    }

    setPluginBusy(`${plugin.pluginId}:${op}`);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: pluginServerId,
          pluginId: plugin.pluginId,
          op,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const payload = readPluginPayload(data);
      const message = res.ok
        ? payload.message ||
          (op === "health"
            ? payload.ok
              ? `${plugin.name} is present on this node.`
              : `${plugin.name} is not present on this node.`
            : payload.ok
              ? `${plugin.name} is installed on this node.`
              : `${plugin.name} could not be installed. See the agent message.`)
        : formatPluginError(data.error);

      const result: PluginActionResult = {
        op,
        ok: res.ok && payload.ok,
        message,
      };
      setPluginResults((prev) => ({ ...prev, [plugin.pluginId]: result }));

      await alert(result.message, {
        title:
          op === "health"
            ? `${plugin.name} — health check`
            : `${plugin.name} — install`,
        tone: result.ok ? "success" : res.ok ? "warning" : "danger",
        detail: op === "health"
          ? "The agent looked for this software on the node and returned the result above."
          : "The agent ran package install (apt/dnf) as root on this node.",
      });
      await loadPlugins(pluginServerId);
    } finally {
      setPluginBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Servers"
        description="Hosting nodes for your sites"
        actionLabel="Add server"
        onAction={openAdd}
        actionIcon={<Plus className="h-3.5 w-3.5" />}
      />
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {servers.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-slate-800 bg-slate-950/80 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Server className="h-4 w-4 text-sky-400" />
                  {s.name}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{s.hostname}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  s.lastPingError
                    ? "bg-red-500/15 text-red-300"
                    : s.lastSeenAt
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-slate-800 text-slate-400"
                }`}
              >
                {s.lastPingError ? "Unreachable" : s.lastSeenAt ? "Seen" : "Unknown"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {s.ipAddress}
              {s.agentUrl ? ` · ${s.agentUrl}` : " · no Agent URL"}
              {` · ${s.domainCount} domain${s.domainCount === 1 ? "" : "s"}`}
              {` · key ${s.agentKeyHint}`}
            </p>
            {s.lastPingError ? (
              <p className="mt-1 text-xs text-red-400">{s.lastPingError}</p>
            ) : null}
            {s.lastSeenAt ? (
              <p className="mt-1 text-[11px] text-slate-600">
                Last ping {new Date(s.lastSeenAt).toLocaleString()}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pinging === s.id}
                onClick={() => void ping(s.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                <Radio className="h-3 w-3" />
                {pinging === s.id ? "Pinging…" : "Ping agent"}
              </button>
              <button
                type="button"
                onClick={() => openEdit(s)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => void loadPlugins(s.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
              >
                <Puzzle className="h-3 w-3" />
                Plugins
              </button>
              <button
                type="button"
                onClick={() => void remove(s)}
                className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {pluginServerId ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <p className="text-sm font-medium text-white">
            Plugins on {servers.find((s) => s.id === pluginServerId)?.hostname ?? pluginServerId}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Health checks whether the software is on this server. Install runs
            apt/dnf as root so you can use it from Databases, Apps, Mail, DNS, FTP,
            or Docker.
          </p>
          {pluginsError ? (
            <p className="mt-2 text-sm text-red-400">{pluginsError}</p>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plugins.map((p) => (
              <div
                key={p.pluginId}
                className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"
              >
                <p className="text-xs font-medium text-slate-200">
                  {p.name}{" "}
                  <span className="font-normal text-slate-500">({p.kind})</span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {p.installed ? "Installed" : "Available"}
                  {p.health ? ` · ${p.health}` : ""}
                </p>
                {pluginResults[p.pluginId] ? (
                  <p
                    className={`mt-2 rounded border px-2 py-1.5 text-[11px] leading-snug ${
                      pluginResults[p.pluginId].ok
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    }`}
                  >
                    <span className="font-medium text-white">
                      {pluginResults[p.pluginId].op === "health"
                        ? "Health: "
                        : "Install: "}
                    </span>
                    {pluginResults[p.pluginId].message}
                  </p>
                ) : null}
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    disabled={pluginBusy.startsWith(p.pluginId)}
                    onClick={() => void runPlugin(p, "health")}
                    className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {pluginBusy === `${p.pluginId}:health`
                      ? "Checking…"
                      : "Check health"}
                  </button>
                  {!p.installed ? (
                    <button
                      type="button"
                      disabled={pluginBusy.startsWith(p.pluginId)}
                      onClick={() => void runPlugin(p, "install")}
                      className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {pluginBusy === `${p.pluginId}:install`
                        ? "Working…"
                        : "Install"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Modal
        open={open}
        onClose={closeModal}
        title={editing ? "Edit server" : "Add server"}
        description="Remote node must run naviyra-agent with a known AGENT_API_KEY."
      >
        <form onSubmit={saveServer} className="space-y-3">
          <label className="block">
            <span className={modalLabelClass}>Name</span>
            <input
              className={modalInputClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </label>
          <label className="block">
            <span className={modalLabelClass}>Hostname</span>
            <input
              className={modalInputClass}
              value={form.hostname}
              onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value }))}
              placeholder="s2.example.com"
              required
            />
          </label>
          <label className="block">
            <span className={modalLabelClass}>IP address</span>
            <input
              className={modalInputClass}
              value={form.ipAddress}
              onChange={(e) => setForm((f) => ({ ...f, ipAddress: e.target.value }))}
              required
            />
          </label>
          <label className="block">
            <span className={modalLabelClass}>Agent URL (optional)</span>
            <input
              className={modalInputClass}
              value={form.agentUrl}
              onChange={(e) => setForm((f) => ({ ...f, agentUrl: e.target.value }))}
              placeholder="http://10.0.0.2:4000"
            />
          </label>
          <label className="block">
            <span className={modalLabelClass}>Agent API key (optional)</span>
            <input
              className={modalInputClass}
              value={form.agentKey}
              onChange={(e) => setForm((f) => ({ ...f, agentKey: e.target.value }))}
              placeholder={
                editing
                  ? `Leave empty to keep ${editing.agentKeyHint}`
                  : "Leave empty to generate"
              }
            />
          </label>
          <label className="block">
            <span className={modalLabelClass}>Notes (optional)</span>
            <input
              className={modalInputClass}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : editing ? "Save" : "Add"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
