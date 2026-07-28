"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Archive,
  Inbox,
  Mail,
  PenSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { MailFolder } from "@/lib/mail/types";
import { FOLDER_LABELS, MAIL_FOLDERS } from "@/lib/mail/types";

type MailMessage = {
  id: string;
  folder: MailFolder;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  date: string;
  read: boolean;
};

type FolderCounts = Record<MailFolder, number>;

const FOLDER_ICONS: Partial<Record<MailFolder, typeof Inbox>> = {
  INBOX: Inbox,
  Drafts: PenSquare,
  Sent: Send,
  Trash: Trash2,
  Archive: Archive,
  Junk: ShieldAlert,
};

function parseRecipients(value: string): string[] {
  return value
    .split(/[,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export default function MailboxPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;

  const [email, setEmail] = useState("");
  const [folder, setFolder] = useState<MailFolder>("INBOX");
  const [counts, setCounts] = useState<FolderCounts | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<MailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeError, setComposeError] = useState("");
  const [draftId, setDraftId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  const loadOverview = useCallback(async () => {
    const res = await fetch(`/api/mail/messages?accountId=${accountId}`);
    const data = await res.json();
    if (data.account) setEmail(data.account.email);
    if (data.counts) setCounts(data.counts);
  }, [accountId]);

  const loadFolder = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/mail/messages?accountId=${accountId}&folder=${folder}`
    );
    const data = await res.json();
    setMessages(data.messages ?? []);
    setLoading(false);
    await loadOverview();
  }, [accountId, folder, loadOverview]);

  const loadMessage = useCallback(
    async (messageId: string) => {
      const res = await fetch(
        `/api/mail/messages/${messageId}?accountId=${accountId}&folder=${folder}`
      );
      const data = await res.json();
      setSelectedMessage(data.message ?? null);
      setSelectedId(messageId);
      await loadFolder();
    },
    [accountId, folder, loadFolder]
  );

  useEffect(() => {
    loadFolder();
  }, [loadFolder]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedMessage(null);
  }, [folder]);

  function openCompose(message?: MailMessage) {
    setComposeError("");
    if (message && folder === "Drafts") {
      setDraftId(message.id);
      setComposeTo(message.to.join(", "));
      setComposeSubject(message.subject);
      setComposeBody(message.body);
    } else {
      setDraftId(undefined);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    }
    setComposeOpen(true);
  }

  async function handleSend(e: FormEvent, draft = false) {
    e.preventDefault();
    setComposeError("");
    const recipients = parseRecipients(composeTo);
    if (!draft && recipients.length === 0) {
      setComposeError("Add at least one recipient");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/mail/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          to: recipients,
          subject: composeSubject,
          body: composeBody,
          draft,
          draftId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setComposeError(
          typeof data.error === "string"
            ? data.error
            : "Failed to send message"
        );
        return;
      }
      setComposeOpen(false);
      setDraftId(undefined);
      if (!draft) setFolder("Sent");
      else setFolder("Drafts");
      await loadFolder();
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function handleMove(targetFolder: MailFolder) {
    if (!selectedId) return;
    await fetch(`/api/mail/messages/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", accountId, folder, targetFolder }),
    });
    setSelectedId(null);
    setSelectedMessage(null);
    await loadFolder();
  }

  async function handleDelete(permanent = false) {
    if (!selectedId) return;
    await fetch(
      `/api/mail/messages/${selectedId}?accountId=${accountId}&folder=${folder}&permanent=${permanent}`,
      { method: "DELETE" }
    );
    setSelectedId(null);
    setSelectedMessage(null);
    await loadFolder();
  }

  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 ring-1 ring-emerald-500/30">
            <Mail className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{email || "Mailbox"}</p>
            <p className="text-xs text-slate-500">Naviyra Webmail</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCompose()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <PenSquare className="h-4 w-4" />
            Compose
          </button>
          <button
            type="button"
            onClick={() => loadFolder()}
            className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/webmail/login", { method: "DELETE" });
              window.location.href = "/webmail";
            }}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:text-white"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950 p-3">
          <nav className="space-y-0.5">
            {MAIL_FOLDERS.map((f) => {
              const Icon = FOLDER_ICONS[f] ?? Mail;
              const active = folder === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFolder(f)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20"
                      : "text-slate-400 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    {FOLDER_LABELS[f]}
                  </span>
                  <span className="text-xs text-slate-500">{counts?.[f] ?? 0}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex w-80 shrink-0 flex-col border-r border-slate-800">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">{FOLDER_LABELS[folder]}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-slate-500">Loading...</p>
            ) : messages.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No messages.</p>
            ) : (
              messages.map((msg) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => loadMessage(msg.id)}
                  onDoubleClick={() => {
                    if (folder === "Drafts") openCompose(msg);
                  }}
                  className={`block w-full border-b border-slate-800/60 px-4 py-3 text-left transition hover:bg-slate-900/80 ${
                    selectedId === msg.id ? "bg-slate-900" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`truncate text-sm ${
                        msg.read ? "text-slate-300" : "font-semibold text-white"
                      }`}
                    >
                      {folder === "Sent" || folder === "Drafts"
                        ? msg.to.join(", ") || "(no recipient)"
                        : msg.from}
                    </p>
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {formatDate(msg.date)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {msg.subject || "(no subject)"}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          {selectedMessage ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-5 py-3">
                <button
                  type="button"
                  onClick={() => handleMove("Archive")}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() => handleMove("Junk")}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Junk
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(folder === "Trash")}
                  className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                >
                  {folder === "Trash" ? "Delete forever" : "Delete"}
                </button>
                {folder === "Drafts" && (
                  <button
                    type="button"
                    onClick={() => openCompose(selectedMessage)}
                    className="rounded-lg border border-emerald-500/30 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10"
                  >
                    Edit draft
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <h3 className="text-lg font-semibold text-white">
                  {selectedMessage.subject || "(no subject)"}
                </h3>
                <div className="mt-3 space-y-1 text-sm text-slate-400">
                  <p>
                    <span className="text-slate-500">From:</span> {selectedMessage.from}
                  </p>
                  <p>
                    <span className="text-slate-500">To:</span>{" "}
                    {selectedMessage.to.join(", ") || "—"}
                  </p>
                  {selectedMessage.cc.length > 0 && (
                    <p>
                      <span className="text-slate-500">Cc:</span>{" "}
                      {selectedMessage.cc.join(", ")}
                    </p>
                  )}
                  <p>
                    <span className="text-slate-500">Date:</span>{" "}
                    {formatDate(selectedMessage.date)}
                  </p>
                </div>
                <pre className="mt-6 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-200">
                  {selectedMessage.body}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-slate-500">
              Select a message to read
            </div>
          )}
        </section>
      </div>

      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <h3 className="font-semibold text-white">New message</h3>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => handleSend(e, false)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="space-y-3 p-5">
                <input
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="To (comma separated)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <input
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Write your message..."
                  rows={12}
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                {composeError ? (
                  <p className="text-sm text-red-400">{composeError}</p>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">
                <button
                  type="button"
                  onClick={(e) => handleSend(e, true)}
                  disabled={sending}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Save draft
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
