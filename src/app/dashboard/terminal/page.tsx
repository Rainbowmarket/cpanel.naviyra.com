"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Plug, Unplug } from "lucide-react";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";

type HostingTarget = { id: string; label: string; documentRoot: string };
type LogLine = { id?: string; at: string; kind: string; text: string };

export default function TerminalPage() {
  const [role, setRole] = useState<"ADMIN" | "RESELLER" | "USER" | "">("");
  const [targets, setTargets] = useState<HostingTarget[]>([]);
  const [targetId, setTargetId] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const [cwd, setCwd] = useState("");
  const [mode, setMode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState("");

  const [termReady, setTermReady] = useState(false);

  const termRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cmdBufRef = useRef("");
  const pendingLogsRef = useRef<Array<{ at: string; kind: "cmd" | "out" | "sys"; text: string }>>(
    []
  );
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        const r = d.user?.role ?? d.role ?? "";
        setRole(r);
      })
      .catch(() => setError("Failed to load session"));

    fetch("/api/terminal/targets")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          if (r.status === 403) setRole((prev) => prev || "USER");
          return;
        }
        setRole(d.role ?? "");
        setTargets(d.targets ?? []);
        setTargetId("");
      })
      .catch(() => {
        /* targets load optional when non-admin */
      });
  }, []);

  const flushLogs = useCallback(async () => {
    const sid = sessionIdRef.current;
    const lines = pendingLogsRef.current.splice(0, pendingLogsRef.current.length);
    if (!sid || lines.length === 0) return;
    try {
      await fetch("/api/terminal/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, lines }),
      });
    } catch {
      /* ignore */
    }
  }, []);

  const queueLog = useCallback(
    (kind: "cmd" | "out" | "sys", text: string) => {
      const entry = { at: new Date().toISOString(), kind, text };
      pendingLogsRef.current.push(entry);
      setLogs((prev) => [...prev.slice(-200), { ...entry, kind: kind.toUpperCase() }]);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        void flushLogs();
      }, 800);
    },
    [flushLogs]
  );

  useEffect(() => {
    // xterm mounts only on the ADMIN UI — wait until that tree exists.
    if (role !== "ADMIN") {
      setTermReady(false);
      return;
    }

    let disposed = false;
    let onResize: (() => void) | null = null;
    let onPaste: ((ev: ClipboardEvent) => void) | null = null;

    async function initTerm() {
      // Wait a frame so termRef is attached after the ADMIN render.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (disposed || !termRef.current || xtermRef.current) return;

      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");
      if (disposed || !termRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        allowProposedApi: true,
        theme: {
          background: "#020617",
          foreground: "#e2e8f0",
          cursor: "#34d399",
          selectionBackground: "#334155",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(termRef.current);
      fit.fit();
      if (term.cols < 20 || term.rows < 5) {
        term.resize(80, 24);
      }
      xtermRef.current = term;
      fitRef.current = fit;
      setTermReady(true);
      term.focus();

      const pasteText = (raw: string) => {
        const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        if (!text) return;
        term.paste(text);
      };

      // Clipboard: Ctrl/Cmd+C copies selection; without selection Ctrl+C is SIGINT.
      // Ctrl/Cmd+V pastes (xterm would otherwise send ^V).
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;
        if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return true;

        if (ev.code === "KeyC") {
          const selected = term.getSelection();
          if (selected) {
            ev.preventDefault();
            void navigator.clipboard.writeText(selected).catch(() => {
              /* clipboard permission denied */
            });
            return false;
          }
          // No selection → let xterm send ^C (interrupt) to the shell.
          return true;
        }

        if (ev.code === "KeyV") {
          ev.preventDefault();
          void navigator.clipboard.readText().then(pasteText).catch(() => {
            /* permission denied — right-click / paste event may still work */
          });
          return false;
        }

        return true;
      });

      onPaste = (ev: ClipboardEvent) => {
        const text = ev.clipboardData?.getData("text");
        if (text == null || text === "") return;
        ev.preventDefault();
        ev.stopPropagation();
        pasteText(text);
      };
      term.textarea?.addEventListener("paste", onPaste);
      term.element?.addEventListener("paste", onPaste);

      term.onData((data) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "input", data }));

        for (const ch of data) {
          if (ch === "\r" || ch === "\n") {
            const cmd = cmdBufRef.current.trim();
            if (cmd) queueLog("cmd", cmd);
            cmdBufRef.current = "";
          } else if (ch === "\u007f" || ch === "\b") {
            cmdBufRef.current = cmdBufRef.current.slice(0, -1);
          } else if (ch >= " " && ch !== "\x1b") {
            cmdBufRef.current += ch;
          }
        }
      });

      onResize = () => {
        fit.fit();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN && term.cols >= 20 && term.rows >= 5) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            })
          );
        }
      };
      window.addEventListener("resize", onResize);
    }

    void initTerm();
    return () => {
      disposed = true;
      setTermReady(false);
      if (onResize) window.removeEventListener("resize", onResize);
      const term = xtermRef.current;
      if (onPaste && term) {
        term.textarea?.removeEventListener("paste", onPaste);
        term.element?.removeEventListener("paste", onPaste);
      }
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      term?.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [queueLog, role]);

  async function disconnect() {
    const sid = sessionIdRef.current;
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setStatus("Disconnected");
    await flushLogs();
    if (sid) {
      await fetch("/api/terminal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", sessionId: sid }),
      }).catch(() => null);
    }
    sessionIdRef.current = null;
    setSessionId(null);
  }

  async function connect() {
    setError("");
    if (role !== "ADMIN" && !targetId) {
      setError("Select a domain or subdomain first");
      return;
    }

    await disconnect();
    setStatus("Connecting…");
    setLogs([]);

    const res = await fetch("/api/terminal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: targetId || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.message || "Failed to create session");
      setStatus("Disconnected");
      return;
    }

    sessionIdRef.current = data.sessionId;
    setSessionId(data.sessionId);
    setCwd(data.cwd);
    setMode(data.mode);
    setLogs([
      {
        at: new Date().toISOString(),
        kind: "SYS",
        text: `Session started (${data.mode}) cwd=${data.cwd}`,
      },
    ]);

    const term = xtermRef.current;
    const fit = fitRef.current;
    if (!term) {
      setError("Terminal UI is still loading — wait a second and try Connect again.");
      setStatus("Disconnected");
      return;
    }
    term.reset();
    fit?.fit();
    if (term.cols < 20 || term.rows < 5) {
      term.resize(80, 24);
    }
    term.focus();

    const ws = new WebSocket(data.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setStatus("Connected");
      term.focus();
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: Math.max(20, term.cols),
          rows: Math.max(5, term.rows),
        })
      );
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string;
          data?: string;
          code?: number;
        };
        if (msg.type === "ready") {
          term.write("\r\n\x1b[32m[Naviyra]\x1b[0m Shell connected.\r\n");
          return;
        }
        if (msg.type === "output" && typeof msg.data === "string") {
          term.write(msg.data);
          if (msg.data.includes("\n") || msg.data.length > 80) {
            const plain = msg.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
            if (plain.length > 2) {
              queueLog("out", plain.slice(0, 500));
            }
          }
        } else if (msg.type === "exit") {
          setStatus(`Exited (${msg.code ?? 0})`);
          setConnected(false);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      setError("WebSocket error — check agent and TERMINAL_WS_URL");
      setStatus("Error");
    };

    ws.onclose = () => {
      setConnected(false);
      setStatus((s) => (s === "Error" ? s : "Disconnected"));
      void flushLogs();
    };
  }

  const targetOptions = [
    ...(role === "ADMIN"
      ? [{ value: "", label: "Server root (full shell)" }]
      : []),
    ...targets.map((t) => ({ value: t.id, label: `${t.label} — ${t.documentRoot}` })),
  ];

  if (!role) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Terminal"
          description="Interactive server shell (administrators only)."
        />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (role !== "ADMIN") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Terminal"
          description="Interactive server shell (administrators only)."
        />
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Terminal access is restricted to administrators. The previous “jail”
          mode was not a security boundary.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Terminal"
        description="Interactive shell with session command log. Administrator access — runs with agent process privileges."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Working directory
          </label>
          <Select
            value={targetId}
            onChange={setTargetId}
            options={targetOptions}
            placeholder="Choose domain or subdomain..."
            disabled={connected}
          />
        </div>
        <button
          type="button"
          onClick={() => void (connected ? disconnect() : connect())}
          disabled={!connected && !termReady}
          className={
            connected
              ? "inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-500"
              : "inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {connected ? (
            <>
              <Unplug className="h-4 w-4" /> Disconnect
            </>
          ) : (
            <>
              <Plug className="h-4 w-4" /> Connect
            </>
          )}
        </button>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <TerminalIcon className="h-4 w-4 text-emerald-400" />
          <span>{status}</span>
          {mode && (
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-300">
              {mode}
            </span>
          )}
          {cwd && <span className="truncate font-mono text-xs text-slate-500">{cwd}</span>}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-inner">
          <div ref={termRef} className="h-[min(60vh,520px)] w-full p-2" />
          <p className="border-t border-slate-800 px-3 py-1.5 text-[11px] text-slate-500">
            Select text then Ctrl+C to copy. Paste with Ctrl+V (⌘C / ⌘V on
            Mac). With no selection, Ctrl+C still interrupts the shell. Click
            the terminal first so it has focus.
          </p>
        </div>

        <div className="flex max-h-[min(60vh,520px)] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
          <div className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Session log
            {sessionId && (
              <span className="ml-2 font-mono font-normal normal-case text-slate-600">
                {sessionId.slice(0, 8)}…
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {logs.length === 0 ? (
              <p className="text-sm text-slate-500">Connect to start logging commands.</p>
            ) : (
              logs.map((l, i) => (
                <div key={`${l.at}-${i}`} className="text-xs">
                  <div className="flex items-center gap-2 text-slate-500">
                    <span className="font-mono">
                      {new Date(l.at).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        l.kind === "CMD" || l.kind === "cmd"
                          ? "text-emerald-400"
                          : l.kind === "SYS" || l.kind === "sys"
                            ? "text-amber-400"
                            : "text-slate-400"
                      }
                    >
                      {l.kind}
                    </span>
                  </div>
                  <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-slate-300">
                    {l.text}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
