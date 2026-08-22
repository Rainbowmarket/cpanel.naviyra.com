import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { controllerAgentTarget } from "@/lib/agent/target";

export type ServiceTestId =
  | "panel-systemd"
  | "panel-http"
  | "agent"
  | "sqlite"
  | "postgres"
  | "nginx-service"
  | "nginx-config"
  | "nginx-access-log"
  | "nginx-error-log"
  | "nginx-visitor-log"
  | "ingest-timer"
  | "expire-timer";

export type ServiceTestMeta = {
  id: ServiceTestId;
  name: string;
  what: string;
};

export const SERVICE_TEST_CATALOG: ServiceTestMeta[] = [
  {
    id: "panel-systemd",
    name: "Panel process",
    what: "systemd unit naviyra-panel.service is active",
  },
  {
    id: "panel-http",
    name: "Panel HTTP",
    what: "GET http://127.0.0.1:$PANEL_PORT/login returns a page",
  },
  {
    id: "agent",
    name: "Server agent",
    what: "Local hosting agent answers ping",
  },
  {
    id: "sqlite",
    name: "Panel database",
    what: "SQLite (naviyra.db) accepts a query",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    what: "Customer database engine is listening on localhost:5432",
  },
  {
    id: "nginx-service",
    name: "nginx process",
    what: "systemd unit nginx.service is active",
  },
  {
    id: "nginx-config",
    name: "nginx config",
    what: "nginx -t parses /etc/nginx/nginx.conf",
  },
  {
    id: "nginx-access-log",
    name: "Access log",
    what: "/var/log/nginx/access.log exists (every HTTP request nginx handled)",
  },
  {
    id: "nginx-error-log",
    name: "Error log",
    what: "/var/log/nginx/error.log exists (nginx failures and config errors)",
  },
  {
    id: "nginx-visitor-log",
    name: "Visitor log",
    what: "/var/log/nginx/naviyra-visitors.log exists (Security Manager $host log)",
  },
  {
    id: "ingest-timer",
    name: "Visitor ingest timer",
    what: "naviyra-visitor-ingest.timer is active (posts visits every minute)",
  },
  {
    id: "expire-timer",
    name: "Auto-block timer",
    what: "naviyra-expire-blocks.timer is active",
  },
];

export type ServiceTestResult = {
  id: ServiceTestId;
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
  ms: number;
};

function systemctlActive(unit: string): boolean {
  if (process.platform !== "linux") return false;
  const r = spawnSync("systemctl", ["is-active", "--quiet", unit], {
    windowsHide: true,
  });
  return r.status === 0;
}

function logInfo(file: string): { exists: boolean; bytes: number } {
  try {
    const st = fs.statSync(file);
    return { exists: st.isFile(), bytes: st.size };
  } catch {
    return { exists: false, bytes: 0 };
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function portOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    const t = setTimeout(() => done(false), timeoutMs);
    socket.on("connect", () => {
      clearTimeout(t);
      done(true);
    });
    socket.on("error", () => {
      clearTimeout(t);
      done(false);
    });
  });
}

async function runOne(id: ServiceTestId): Promise<Omit<ServiceTestResult, "ms">> {
  const meta = SERVICE_TEST_CATALOG.find((t) => t.id === id);
  const name = meta?.name ?? id;
  const linux = process.platform === "linux";

  if (id === "panel-systemd") {
    if (!linux) {
      return { id, name, ok: true, skipped: true, detail: "systemd is Linux-only" };
    }
    const ok = systemctlActive("naviyra-panel.service");
    return {
      id,
      name,
      ok,
      detail: ok ? "naviyra-panel.service is active" : "unit is not active — systemctl status naviyra-panel",
    };
  }

  if (id === "panel-http") {
    const port = process.env.PANEL_PORT?.trim() || "3100";
    const url = `http://127.0.0.1:${port}/login`;
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
      });
      const ok = res.status >= 200 && res.status < 500;
      return {
        id,
        name,
        ok,
        detail: ok ? `${url} → HTTP ${res.status}` : `${url} → HTTP ${res.status}`,
      };
    } catch (error) {
      return {
        id,
        name,
        ok: false,
        detail: error instanceof Error ? error.message : `Could not reach ${url}`,
      };
    }
  }

  if (id === "agent") {
    const ping = await callAgent({ action: "ping" }, await controllerAgentTarget());
    return {
      id,
      name,
      ok: ping.success,
      detail: ping.success
        ? `Agent reachable (${ping.via ?? "ok"})`
        : ping.error || "Agent did not answer ping",
    };
  }

  if (id === "sqlite") {
    try {
      const n = await prisma.user.count();
      return { id, name, ok: true, detail: `SQLite OK (${n} user${n === 1 ? "" : "s"})` };
    } catch (error) {
      return {
        id,
        name,
        ok: false,
        detail: error instanceof Error ? error.message : "SQLite query failed",
      };
    }
  }

  if (id === "postgres") {
    const listening = await portOpen("127.0.0.1", 5432);
    const unitOk = linux ? systemctlActive("postgresql.service") : listening;
    const ok = listening || unitOk;
    return {
      id,
      name,
      ok,
      detail: listening
        ? "Listening on 127.0.0.1:5432"
        : unitOk
          ? "postgresql.service is active"
          : "Not listening on 5432 — customer databases need PostgreSQL",
    };
  }

  if (id === "nginx-service") {
    if (!linux) {
      return { id, name, ok: true, skipped: true, detail: "nginx checks are Linux-only" };
    }
    const ok = systemctlActive("nginx.service");
    return {
      id,
      name,
      ok,
      detail: ok ? "nginx.service is active" : "nginx is not running",
    };
  }

  if (id === "nginx-config") {
    if (!linux || !fs.existsSync("/etc/nginx/nginx.conf")) {
      return { id, name, ok: true, skipped: true, detail: "nginx.conf not present" };
    }
    const r = spawnSync("nginx", ["-t"], { encoding: "utf8", windowsHide: true });
    const err = ((r.stderr || "") + (r.stdout || "")).trim();
    return {
      id,
      name,
      ok: r.status === 0,
      detail: r.status === 0 ? "nginx -t passed" : err.slice(-240) || "nginx -t failed",
    };
  }

  if (id === "nginx-access-log") {
    const file = "/var/log/nginx/access.log";
    const info = logInfo(file);
    return {
      id,
      name,
      ok: info.exists,
      detail: info.exists
        ? `${file} (${formatBytes(info.bytes)}) — one line per HTTP request`
        : `${file} missing`,
    };
  }

  if (id === "nginx-error-log") {
    const file = "/var/log/nginx/error.log";
    const info = logInfo(file);
    return {
      id,
      name,
      ok: info.exists,
      detail: info.exists
        ? `${file} (${formatBytes(info.bytes)}) — nginx errors, not website 404s in the UI`
        : `${file} missing`,
    };
  }

  if (id === "nginx-visitor-log") {
    const file = "/var/log/nginx/naviyra-visitors.log";
    const info = logInfo(file);
    return {
      id,
      name,
      ok: info.exists,
      detail: info.exists
        ? `${file} (${formatBytes(info.bytes)}) — Security visitors ($host)`
        : `${file} missing — run the panel installer as root`,
    };
  }

  if (id === "ingest-timer") {
    if (!linux) {
      return { id, name, ok: true, skipped: true, detail: "Linux only" };
    }
    const ok = systemctlActive("naviyra-visitor-ingest.timer");
    return {
      id,
      name,
      ok,
      detail: ok
        ? "Timer active — ingest runs every minute"
        : "Timer inactive — sudo bash scripts/install-visitor-ingest.sh",
    };
  }

  if (id === "expire-timer") {
    if (!linux) {
      return { id, name, ok: true, skipped: true, detail: "Linux only" };
    }
    const ok = systemctlActive("naviyra-expire-blocks.timer");
    return {
      id,
      name,
      ok,
      detail: ok ? "Timer active" : "Timer inactive",
    };
  }

  return { id, name, ok: false, detail: "Unknown test" };
}

export async function runServiceTest(id: string): Promise<ServiceTestResult> {
  const typed = SERVICE_TEST_CATALOG.find((t) => t.id === id)?.id;
  if (!typed) {
    return { id: id as ServiceTestId, name: id, ok: false, detail: "Unknown test id", ms: 0 };
  }
  const started = Date.now();
  const result = await runOne(typed);
  return { ...result, ms: Date.now() - started };
}
