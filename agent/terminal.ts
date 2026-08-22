import type http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { API_KEY } from "./paths";
import { verifyTerminalToken, type TerminalTokenClaims } from "./terminal-token";
import { assertSafeDocumentRoot } from "./hostname";

const MAX_SESSIONS = 5;
const IDLE_MS = 30 * 60 * 1000;
const isWindows = process.platform === "win32";

type PtyLike = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
};

let activeSessions = 0;
const usedSids = new Set<string>();

function send(ws: WebSocket, msg: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Jail mode binds only the tenant document root (bubblewrap) so `cd ..` and
 * `/etc` walks cannot reach other sites. Full mode remains an admin host shell.
 */
function resolveCwd(claims: TerminalTokenClaims): string {
  if (claims.mode === "jail") {
    return assertSafeDocumentRoot(claims.cwd);
  }
  const cwd = path.resolve(claims.cwd || "/");
  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd, { recursive: true });
  }
  return cwd;
}

function findBwrap(): string | null {
  for (const file of ["/usr/bin/bwrap", "/bin/bwrap"]) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function jailArgs(cwd: string, shell: string): { bin: string; args: string[] } {
  const bwrap = findBwrap();
  if (!bwrap) {
    if (process.env.AGENT_ALLOW_WEAK_JAIL === "true") {
      return { bin: shell, args: ["--noprofile", "--norc", "-r"] };
    }
    throw new Error(
      "Jail terminal requires bubblewrap (apt install bubblewrap). " +
        "Set AGENT_ALLOW_WEAK_JAIL=true only for lab hosts."
    );
  }
  const args = [
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-ipc",
    "--die-with-parent",
    "--share-net",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/bin",
    "/bin",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    cwd,
    cwd,
    "--chdir",
    cwd,
    "--setenv",
    "HOME",
    cwd,
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
  ];
  if (fs.existsSync("/lib")) args.push("--ro-bind", "/lib", "/lib");
  if (fs.existsSync("/lib64")) args.push("--ro-bind", "/lib64", "/lib64");
  if (fs.existsSync("/etc")) args.push("--ro-bind", "/etc", "/etc");
  args.push(shell, "--noprofile", "--norc", "-i");
  return { bin: bwrap, args };
}

async function spawnPty(
  claims: TerminalTokenClaims,
  cols: number,
  rows: number,
  dryRun: boolean
): Promise<PtyLike> {
  if (dryRun) {
    let dataCb: ((data: string) => void) | null = null;
    let exitCb: ((e: { exitCode: number }) => void) | null = null;
    const banner =
      "\r\n[Naviyra] DRY RUN — live shell disabled on this agent.\r\n" +
      `Mode=${claims.mode} cwd=${claims.cwd}\r\n` +
      "Set AGENT_DRY_RUN=false and run as admin/root for a real PTY.\r\n\r\n";
    queueMicrotask(() => dataCb?.(banner));
    return {
      write: (data: string) => {
        if (data.includes("\r") || data.includes("\n")) {
          dataCb?.(`\r\n[dry-run] command ignored\r\n`);
        }
      },
      resize: () => {},
      kill: () => exitCb?.({ exitCode: 0 }),
      onData: (cb) => {
        dataCb = cb;
      },
      onExit: (cb) => {
        exitCb = cb;
      },
    };
  }

  const pty = await import("node-pty");
  const cwd = resolveCwd(claims);
  const shell = isWindows
    ? process.env.COMSPEC || "powershell.exe"
    : fs.existsSync("/bin/bash")
      ? "/bin/bash"
      : "/bin/sh";

  let bin = shell;
  let args: string[] = isWindows ? [] : ["-i"];
  if (!isWindows && claims.mode === "jail") {
    const jail = jailArgs(cwd, shell);
    bin = jail.bin;
    args = jail.args;
  }

  const env: Record<string, string> = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    HOME: claims.mode === "jail" ? cwd : process.env.HOME || cwd,
    PATH:
      claims.mode === "jail"
        ? "/usr/bin:/bin"
        : process.env.PATH || "/usr/bin:/bin",
  };

  const proc = pty.spawn(bin, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env,
  });

  return {
    write: (data) => proc.write(data),
    resize: (c, r) => proc.resize(c, r),
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
    onData: (cb) => {
      if (claims.mode === "jail") {
        queueMicrotask(() =>
          cb(
            "\r\n[Naviyra] Jail: this session can only see this site’s document root.\r\n\r\n"
          )
        );
      }
      proc.onData(cb);
    },
    onExit: (cb) => {
      proc.onExit(cb);
    },
  };
}

export function attachTerminalWs(
  server: http.Server,
  options: { dryRun: boolean }
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    try {
      const host = req.headers.host || "127.0.0.1";
      const url = new URL(req.url || "/", `http://${host}`);
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      if (pathname !== "/terminal") {
        socket.destroy();
        return;
      }

      const token = url.searchParams.get("token") || "";
      let claims: TerminalTokenClaims;
      try {
        claims = verifyTerminalToken(token, API_KEY);
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      if (usedSids.has(claims.sid)) {
        socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (activeSessions >= MAX_SESSIONS) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        void handleSession(ws, claims, options.dryRun);
      });
    } catch {
      socket.destroy();
    }
  });
}

async function handleSession(
  ws: WebSocket,
  claims: TerminalTokenClaims,
  dryRun: boolean
) {
  usedSids.add(claims.sid);
  activeSessions += 1;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let ptyProc: PtyLike | null = null;
  let closed = false;

  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(ws, { type: "output", data: "\r\n[Naviyra] Idle timeout — closing.\r\n" });
      cleanup(0);
    }, IDLE_MS);
  };

  const cleanup = (code: number) => {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    try {
      ptyProc?.kill();
    } catch {
      /* ignore */
    }
    activeSessions = Math.max(0, activeSessions - 1);
    usedSids.delete(claims.sid);
    send(ws, { type: "exit", code });
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  try {
    ptyProc = await spawnPty(claims, 80, 24, dryRun);
    bumpIdle();
    send(ws, {
      type: "ready",
      mode: claims.mode,
      cwd: claims.cwd,
      sid: claims.sid,
    });

    ptyProc.onData((data) => {
      bumpIdle();
      send(ws, { type: "output", data });
    });
    ptyProc.onExit(({ exitCode }) => {
      cleanup(exitCode ?? 0);
    });

    ws.on("message", (raw) => {
      bumpIdle();
      try {
        const msg = JSON.parse(String(raw)) as {
          type?: string;
          data?: string;
          cols?: number;
          rows?: number;
        };
        if (msg.type === "input" && typeof msg.data === "string") {
          ptyProc?.write(msg.data);
        } else if (
          msg.type === "resize" &&
          typeof msg.cols === "number" &&
          typeof msg.rows === "number"
        ) {
          ptyProc?.resize(
            Math.max(20, Math.min(300, msg.cols)),
            Math.max(5, Math.min(100, msg.rows))
          );
        }
      } catch {
        /* ignore bad frames */
      }
    });

    ws.on("close", () => cleanup(0));
    ws.on("error", () => cleanup(1));
  } catch (err) {
    send(ws, {
      type: "output",
      data: `\r\n[Naviyra] Failed to start shell: ${
        err instanceof Error ? err.message : "error"
      }\r\n`,
    });
    cleanup(1);
  }
}
