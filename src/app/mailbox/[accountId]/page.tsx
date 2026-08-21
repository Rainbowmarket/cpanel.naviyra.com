"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Archive,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  RotateCcw,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { MailFolder } from "@/lib/mail/types";
import { FOLDER_LABELS, MAIL_FOLDERS } from "@/lib/mail/types";
import { BrandLogo } from "@/components/ui/brand-logo";

type MailAttachment = {
  filename: string;
  contentType: string;
  size: number;
};

type MailMessage = {
  id: string;
  folder: MailFolder;
  from: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  body: string;
  date: string;
  read: boolean;
  attachments?: MailAttachment[];
};

type FolderCounts = Record<MailFolder, number>;
type ComposeMode = "new" | "draft" | "reply" | "replyAll" | "forward";

/** Dark checkbox with green checked state (overrides browser blue). */
const MAIL_CHECKBOX_CLASS = "mail-checkbox";

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

function extractAddress(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return (m?.[1] ?? value).trim().toLowerCase();
}

function uniqueAddresses(values: string[], exclude: string[] = []): string[] {
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const addr = extractAddress(raw);
    if (!addr || skip.has(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

function withSubjectPrefix(subject: string, prefix: "Re" | "Fwd"): string {
  const trimmed = subject.trim() || "(no subject)";
  if (prefix === "Re" && /^re:\s*/i.test(trimmed)) return trimmed;
  if (prefix === "Fwd" && /^(fwd|fw):\s*/i.test(trimmed)) return trimmed;
  return `${prefix}: ${trimmed}`;
}

/** Clean address display (avoids accidental `>>` from malformed headers). */
function formatAddress(value: string): string {
  return value.replace(/<{2,}/g, "<").replace(/>{2,}/g, ">").trim();
}

/** Strip classic email quote markers for readable display. */
function cleanBodyForDisplay(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^>+\s?/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function quotedBody(message: MailMessage): string {
  return (
    `\n\n-------- Original message --------\n` +
    `From: ${formatAddress(message.from)}\n` +
    `Date: ${formatDateTime(message.date)}\n` +
    `\n${cleanBodyForDisplay(message.body)}`
  );
}

function formatFileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_COMPOSE_ATTACH_BYTES = 20 * 1024 * 1024;

function fileToPayload(file: File): Promise<{
  filename: string;
  contentType: string;
  contentBase64: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const contentBase64 = dataUrl.includes(",")
        ? dataUrl.slice(dataUrl.indexOf(",") + 1)
        : dataUrl;
      resolve({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64,
      });
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
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
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [draftId, setDraftId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [composeFiles, setComposeFiles] = useState<File[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);

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
    setCheckedIds(new Set());
  }, [folder]);

  const allChecked = useMemo(
    () => messages.length > 0 && messages.every((m) => checkedIds.has(m.id)),
    [messages, checkedIds]
  );
  const someChecked = checkedIds.size > 0;

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCheckAll() {
    if (allChecked) {
      setCheckedIds(new Set());
      return;
    }
    setCheckedIds(new Set(messages.map((m) => m.id)));
  }
  function resetComposeFields() {
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    setShowCc(false);
    setShowBcc(false);
    setDraftId(undefined);
    setComposeMode("new");
    setComposeFiles([]);
  }

  async function filesFromMessage(message: MailMessage): Promise<File[]> {
    const list = message.attachments ?? [];
    if (!list.length) return [];
    const files: File[] = [];
    for (let i = 0; i < list.length; i++) {
      const meta = list[i]!;
      const res = await fetch(
        `/api/mail/messages/${encodeURIComponent(message.id)}/attachment?accountId=${encodeURIComponent(accountId)}&folder=${encodeURIComponent(message.folder)}&index=${i}`
      );
      if (!res.ok) continue;
      const blob = await res.blob();
      files.push(
        new File([blob], meta.filename, {
          type: meta.contentType || blob.type || "application/octet-stream",
        })
      );
    }
    return files;
  }

  async function openCompose(message?: MailMessage) {
    setComposeError("");
    if (message && folder === "Drafts") {
      setComposeMode("draft");
      setDraftId(message.id);
      setComposeTo(message.to.join(", "));
      setComposeCc((message.cc ?? []).join(", "));
      setComposeBcc((message.bcc ?? []).join(", "));
      setComposeSubject(message.subject);
      setComposeBody(message.body);
      setShowCc((message.cc ?? []).length > 0);
      setShowBcc((message.bcc ?? []).length > 0);
      setComposeFiles(await filesFromMessage(message));
    } else {
      resetComposeFields();
    }
    setComposeOpen(true);
  }

  function openReply(message: MailMessage, all = false) {
    setComposeError("");
    setDraftId(undefined);
    setComposeMode(all ? "replyAll" : "reply");
    const self = email.toLowerCase();
    const fromAddr = extractAddress(message.from);
    if (all) {
      const toList = uniqueAddresses([fromAddr, ...message.to], [self]);
      const ccList = uniqueAddresses(message.cc ?? [], [self, ...toList]);
      setComposeTo(toList.join(", "));
      setComposeCc(ccList.join(", "));
      setShowCc(ccList.length > 0);
    } else {
      setComposeTo(fromAddr);
      setComposeCc("");
      setShowCc(false);
    }
    setComposeBcc("");
    setShowBcc(false);
    setComposeFiles([]);
    setComposeSubject(withSubjectPrefix(message.subject, "Re"));
    setComposeBody(quotedBody(message));
    setComposeOpen(true);
  }

  async function openForward(message: MailMessage) {
    setComposeError("");
    setDraftId(undefined);
    setComposeMode("forward");
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setShowCc(false);
    setShowBcc(false);
    setComposeSubject(withSubjectPrefix(message.subject, "Fwd"));
    setComposeBody(
      `\n\n---------- Forwarded message ----------\nFrom: ${formatAddress(message.from)}\nDate: ${formatDateTime(message.date)}\nSubject: ${message.subject}\nTo: ${message.to.join(", ") || "—"}\n${
        message.cc?.length ? `Cc: ${message.cc.join(", ")}\n` : ""
      }\n${cleanBodyForDisplay(message.body)}`
    );
    setComposeFiles(await filesFromMessage(message));
    setComposeOpen(true);
  }

  async function handleSend(e: FormEvent, draft = false) {
    e.preventDefault();
    setComposeError("");
    const recipients = parseRecipients(composeTo);
    const cc = parseRecipients(composeCc);
    const bcc = parseRecipients(composeBcc);
    if (!draft && recipients.length === 0 && cc.length === 0 && bcc.length === 0) {
      setComposeError("Add at least one recipient");
      return;
    }
    const attachTotal = composeFiles.reduce((sum, file) => sum + file.size, 0);
    if (composeFiles.length > 10) {
      setComposeError("At most 10 files can be attached");
      return;
    }
    if (attachTotal > MAX_COMPOSE_ATTACH_BYTES) {
      setComposeError("Attachments are larger than 20 MB in total");
      return;
    }
    setSending(true);
    try {
      const attachments =
        composeFiles.length > 0
          ? await Promise.all(composeFiles.map((file) => fileToPayload(file)))
          : undefined;
      const res = await fetch("/api/mail/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          to: recipients,
          cc,
          bcc,
          subject: composeSubject,
          body: composeBody,
          draft,
          draftId,
          attachments,
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
      resetComposeFields();
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
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(selectedId);
      return next;
    });
    await loadFolder();
  }

  async function handleBulkDelete() {
    if (checkedIds.size === 0 || bulkBusy) return;
    const permanent = folder === "Trash";
    const ids = Array.from(checkedIds);
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(
            `/api/mail/messages/${id}?accountId=${accountId}&folder=${folder}&permanent=${permanent}`,
            { method: "DELETE" }
          )
        )
      );
      if (selectedId && checkedIds.has(selectedId)) {
        setSelectedId(null);
        setSelectedMessage(null);
      }
      setCheckedIds(new Set());
      await loadFolder();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkMove(targetFolder: MailFolder) {
    if (checkedIds.size === 0 || bulkBusy) return;
    const ids = Array.from(checkedIds);
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/mail/messages/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "move",
              accountId,
              folder,
              targetFolder,
            }),
          })
        )
      );
      if (selectedId && checkedIds.has(selectedId)) {
        setSelectedId(null);
        setSelectedMessage(null);
      }
      setCheckedIds(new Set());
      await loadFolder();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkRestore() {
    if (checkedIds.size === 0 || bulkBusy) return;
    if (folder !== "Trash" && folder !== "Junk") return;
    const ids = Array.from(checkedIds);
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/mail/messages/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "restore",
              accountId,
              folder,
            }),
          })
        )
      );
      if (selectedId && checkedIds.has(selectedId)) {
        setSelectedId(null);
        setSelectedMessage(null);
      }
      setCheckedIds(new Set());
      await loadFolder();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleRestore() {
    if (!selectedId) return;
    if (folder !== "Trash" && folder !== "Junk") return;
    await fetch(`/api/mail/messages/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", accountId, folder }),
    });
    setSelectedId(null);
    setSelectedMessage(null);
    await loadFolder();
  }

  async function handleBulkMarkRead(read = true) {
    if (checkedIds.size === 0 || bulkBusy) return;
    const ids = Array.from(checkedIds);
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/mail/messages/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "mark_read",
              accountId,
              folder,
              read,
            }),
          })
        )
      );
      setCheckedIds(new Set());
      await loadFolder();
      if (selectedId && selectedMessage) {
        setSelectedMessage({ ...selectedMessage, read });
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const composeTitle =
    composeMode === "reply"
      ? "Reply"
      : composeMode === "replyAll"
        ? "Reply all"
        : composeMode === "forward"
          ? "Forward"
          : composeMode === "draft"
            ? "Edit draft"
            : "New message";

  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <BrandLogo size={36} className="ring-1 ring-white/10" />
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">
                {FOLDER_LABELS[folder]}
              </h2>
              {messages.length > 0 ? (
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleCheckAll}
                    className={MAIL_CHECKBOX_CLASS}
                  />
                  Select all
                </label>
              ) : null}
            </div>
            {someChecked ? (
              <div className="mt-2 space-y-2">
                <span className="text-[11px] text-emerald-400/90">
                  {checkedIds.size} selected
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {folder === "Trash" ? (
                    <button
                      type="button"
                      onClick={handleBulkRestore}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore
                    </button>
                  ) : null}
                  {folder === "Junk" ? (
                    <button
                      type="button"
                      onClick={handleBulkRestore}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Not junk
                    </button>
                  ) : null}
                  {folder !== "Trash" &&
                  folder !== "Sent" &&
                  folder !== "Drafts" ? (
                    <button
                      type="button"
                      onClick={() => handleBulkMarkRead(true)}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      <MailOpen className="h-3 w-3" />
                      Read
                    </button>
                  ) : null}
                  {folder !== "Trash" &&
                  folder !== "Archive" &&
                  folder !== "Sent" &&
                  folder !== "Drafts" ? (
                    <button
                      type="button"
                      onClick={() => handleBulkMove("Archive")}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Archive className="h-3 w-3" />
                      Archive
                    </button>
                  ) : null}
                  {folder !== "Trash" &&
                  folder !== "Junk" &&
                  folder !== "Sent" &&
                  folder !== "Drafts" ? (
                    <button
                      type="button"
                      onClick={() => handleBulkMove("Junk")}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      <ShieldAlert className="h-3 w-3" />
                      Junk
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    disabled={bulkBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    {bulkBusy
                      ? "Working…"
                      : folder === "Trash"
                        ? "Delete forever"
                        : "Delete"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-slate-500">Loading...</p>
            ) : messages.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No messages.</p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 border-b border-slate-800/60 px-3 py-3 transition hover:bg-slate-900/80 ${
                    selectedId === msg.id ? "bg-slate-900" : ""
                  } ${checkedIds.has(msg.id) ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/20" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(msg.id)}
                    onChange={() => toggleChecked(msg.id)}
                    onClick={(e) => e.stopPropagation()}
                    className={`mt-1 ${MAIL_CHECKBOX_CLASS}`}
                    aria-label={`Select ${msg.subject || "message"}`}
                  />
                  <button
                    type="button"
                    onClick={() => loadMessage(msg.id)}
                    onDoubleClick={() => {
                      if (folder === "Drafts") openCompose(msg);
                    }}
                    className="min-w-0 flex-1 text-left"
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
                        {formatDateTime(msg.date)}
                      </span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-400">
                      {(msg.attachments?.length ?? 0) > 0 ? (
                        <Paperclip
                          className="h-3 w-3 shrink-0 text-slate-500"
                          aria-label="Has attachments"
                        />
                      ) : null}
                      <span className="truncate">{msg.subject || "(no subject)"}</span>
                    </p>
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          {selectedMessage ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-5 py-3">
                {folder === "Trash" ? (
                  <>
                    <button
                      type="button"
                      onClick={handleRestore}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(true)}
                      className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      Delete forever
                    </button>
                  </>
                ) : folder === "Junk" ? (
                  <>
                    <button
                      type="button"
                      onClick={handleRestore}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Not junk
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(false)}
                      className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </>
                ) : folder === "Sent" || folder === "Drafts" ? (
                  <>
                    {folder === "Drafts" ? (
                      <button
                        type="button"
                        onClick={() => openCompose(selectedMessage)}
                        className="rounded-lg border border-emerald-500/30 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10"
                      >
                        Edit draft
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openReply(selectedMessage, false)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                        >
                          <Reply className="h-3.5 w-3.5" />
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => openForward(selectedMessage)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                        >
                          <Forward className="h-3.5 w-3.5" />
                          Forward
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(false)}
                      className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openReply(selectedMessage, false)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      <Reply className="h-3.5 w-3.5" />
                      Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => openReply(selectedMessage, true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      <ReplyAll className="h-3.5 w-3.5" />
                      Reply all
                    </button>
                    <button
                      type="button"
                      onClick={() => openForward(selectedMessage)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      <Forward className="h-3.5 w-3.5" />
                      Forward
                    </button>
                    <span className="mx-1 hidden h-4 w-px bg-slate-700 sm:inline-block" />
                    {folder !== "Archive" ? (
                      <button
                        type="button"
                        onClick={() => handleMove("Archive")}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                      >
                        Archive
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleDelete(false)}
                      className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <h3 className="text-lg font-semibold text-white">
                  {selectedMessage.subject || "(no subject)"}
                </h3>
                <div className="mt-3 space-y-1 text-sm text-slate-400">
                  <p>
                    <span className="text-slate-500">From:</span>{" "}
                    {formatAddress(selectedMessage.from)}
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
                  {(selectedMessage.bcc?.length ?? 0) > 0 &&
                    (folder === "Sent" || folder === "Drafts") && (
                      <p>
                        <span className="text-slate-500">Bcc:</span>{" "}
                        {selectedMessage.bcc!.join(", ")}
                      </p>
                    )}
                  <p>
                    <span className="text-slate-500">Date:</span>{" "}
                    {formatDateTime(selectedMessage.date)}
                  </p>
                </div>
                {(selectedMessage.attachments?.length ?? 0) > 0 ? (
                  <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Attachments
                    </p>
                    <ul className="space-y-1">
                      {selectedMessage.attachments!.map((file, index) => (
                        <li key={`${file.filename}-${index}`}>
                          <a
                            href={`/api/mail/messages/${encodeURIComponent(selectedMessage.id)}/attachment?accountId=${encodeURIComponent(accountId)}&folder=${encodeURIComponent(selectedMessage.folder)}&index=${index}`}
                            className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
                          >
                            <Paperclip className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{file.filename}</span>
                            {file.size > 0 ? (
                              <span className="text-xs text-slate-500">
                                {formatFileSize(file.size)}
                              </span>
                            ) : null}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-6 rounded-xl border border-slate-800/80 bg-slate-900/40 px-5 py-5">
                  <pre className="whitespace-pre-wrap font-sans text-[15px] leading-7 text-slate-100">
                    {cleanBodyForDisplay(selectedMessage.body)}
                  </pre>
                </div>
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
              <h3 className="font-semibold text-white">{composeTitle}</h3>
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(false);
                  resetComposeFields();
                }}
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
                <div className="flex items-center gap-2">
                  <input
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder="To (comma separated)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                  {!showCc ? (
                    <button
                      type="button"
                      onClick={() => setShowCc(true)}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      Cc
                    </button>
                  ) : null}
                  {!showBcc ? (
                    <button
                      type="button"
                      onClick={() => setShowBcc(true)}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      Bcc
                    </button>
                  ) : null}
                </div>
                {showCc ? (
                  <input
                    value={composeCc}
                    onChange={(e) => setComposeCc(e.target.value)}
                    placeholder="Cc (comma separated)"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                ) : null}
                {showBcc ? (
                  <input
                    value={composeBcc}
                    onChange={(e) => setComposeBcc(e.target.value)}
                    placeholder="Bcc (comma separated)"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  />
                ) : null}
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
                {composeFiles.length > 0 ? (
                  <ul className="space-y-1 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                    {composeFiles.map((file, index) => (
                      <li
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex items-center justify-between gap-2 text-sm text-slate-300"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span className="truncate">{file.name}</span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {formatFileSize(file.size)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setComposeFiles((prev) =>
                              prev.filter((_, i) => i !== index)
                            )
                          }
                          className="shrink-0 text-xs text-slate-500 hover:text-red-400"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {composeError ? (
                  <p className="text-sm text-red-400">{composeError}</p>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-3">
                <div>
                  <input
                    ref={attachInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const incoming = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (!incoming.length) return;
                      setComposeFiles((prev) => {
                        const next = [...prev, ...incoming].slice(0, 10);
                        const total = next.reduce((sum, file) => sum + file.size, 0);
                        if (total > MAX_COMPOSE_ATTACH_BYTES) {
                          setComposeError("Attachments are larger than 20 MB in total");
                          return prev;
                        }
                        setComposeError("");
                        return next;
                      });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => attachInputRef.current?.click()}
                    disabled={sending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Paperclip className="h-4 w-4" />
                    Attach files
                  </button>
                </div>
                <div className="flex gap-2">
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
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
