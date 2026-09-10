/**
 * Allowlisted systemd units the panel may start/stop/restart.
 * Unknown unit names never reach systemctl.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const isWindows = process.platform === "win32";
const PANEL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export type HostServiceOp = "start" | "stop" | "restart";

export type HostServiceDef = {
  id: string;
  name: string;
  group: string;
  detail: string;
  /** Tried in order; first loaded unit is used. */
  units: string[];
  kind: "service" | "timer";
  allowStop: boolean;
  /** One-shot units to kick after start/restart (e.g. ingest worker). */
  alsoStart?: string[];
};

export type HostServiceStatus = {
  id: string;
  name: string;
  group: string;
  detail: string;
  kind: "service" | "timer";
  unit: string;
  installed: boolean;
  active: boolean;
  enabled: boolean;
  state: string;
  allowStop: boolean;
  dryRun: boolean;
  installable: boolean;
};

export const HOST_SERVICE_CATALOG: HostServiceDef[] = [
  {
    id: "panel",
    name: "Hosting panel",
    group: "Panel",
    detail: "naviyra-panel.service — this web UI. Stop is blocked so you are not locked out.",
    units: ["naviyra-panel.service"],
    kind: "service",
    allowStop: false,
  },
  {
    id: "agent",
    name: "Server agent",
    group: "Panel",
    detail:
      "Applies nginx, mail, and files. Started with the panel process when naviyra-agent.service is not installed.",
    units: ["naviyra-agent.service"],
    kind: "service",
    allowStop: true,
  },
  {
    id: "visitor-ingest",
    name: "Visitor ingest",
    group: "Security",
    detail: "Reads nginx visitor logs every minute for Security → Live visitors.",
    units: ["naviyra-visitor-ingest.timer", "naviyra-visitor-ingest.timer"],
    kind: "timer",
    allowStop: true,
    alsoStart: ["naviyra-visitor-ingest.service", "naviyra-visitor-ingest.service"],
  },
  {
    id: "expire-blocks",
    name: "Auto-block expiry",
    group: "Security",
    detail: "Clears expired automatic IP blocks.",
    units: ["naviyra-expire-blocks.timer", "naviyra-expire-blocks.timer"],
    kind: "timer",
    allowStop: true,
    alsoStart: ["naviyra-expire-blocks.service", "naviyra-expire-blocks.service"],
  },
  {
    id: "host-alerts",
    name: "Host alerts",
    group: "Panel",
    detail: "Hourly CPU/RAM/disk/agent checks that email admins when thresholds are hit.",
    units: ["naviyra-host-alerts.timer", "naviyra-host-alerts.timer"],
    kind: "timer",
    allowStop: true,
    alsoStart: ["naviyra-host-alerts.service", "naviyra-host-alerts.service"],
  },
  {
    id: "security-alerts",
    name: "Security alerts",
    group: "Security",
    detail:
      "Every minute: email all admins if a new public port starts listening or root logs in over SSH.",
    units: ["naviyra-security-alerts.timer", "naviyra-security-alerts.timer"],
    kind: "timer",
    allowStop: true,
    alsoStart: ["naviyra-security-alerts.service", "naviyra-security-alerts.service"],
  },
  {
    id: "backup-timer",
    name: "Backup timer",
    group: "Panel",
    detail: "Scheduled panel/domain backups (naviyra-backup.timer).",
    units: ["naviyra-backup.timer"],
    kind: "timer",
    allowStop: true,
  },
  {
    id: "nginx",
    name: "Nginx",
    group: "Web",
    detail: "Web server and reverse proxy for sites and the panel.",
    units: ["nginx.service"],
    kind: "service",
    allowStop: true,
  },
  {
    id: "php-fpm",
    name: "PHP-FPM",
    group: "Web",
    detail: "PHP worker pool for hosted sites.",
    units: [
      "php8.4-fpm.service",
      "php8.3-fpm.service",
      "php8.2-fpm.service",
      "php8.1-fpm.service",
      "php-fpm.service",
    ],
    kind: "service",
    allowStop: true,
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    group: "Database",
    detail: "Customer databases.",
    units: [
      "postgresql.service",
      "postgresql@16-main.service",
      "postgresql@15-main.service",
      "postgresql@14-main.service",
    ],
    kind: "service",
    allowStop: true,
  },
  {
    id: "postfix",
    name: "Postfix",
    group: "Mail",
    detail: "Outbound / inbound SMTP.",
    units: ["postfix.service"],
    kind: "service",
    allowStop: true,
  },
  {
    id: "dovecot",
    name: "Dovecot",
    group: "Mail",
    detail: "IMAP and POP3 for mailboxes.",
    units: ["dovecot.service"],
    kind: "service",
    allowStop: true,
  },
  {
    id: "ftp",
    name: "FTP",
    group: "FTP",
    detail: "vsftpd or compatible FTP daemon.",
    units: ["vsftpd.service", "proftpd.service", "pure-ftpd.service"],
    kind: "service",
    allowStop: true,
  },
  {
    id: "dns",
    name: "DNS (BIND)",
    group: "DNS",
    detail: "Authoritative DNS for hosted zones.",
    units: ["named.service", "bind9.service"],
    kind: "service",
    allowStop: true,
  },
];

/** Packages the panel can apt-install via scripts/*.sh (not arbitrary units). */
export const HOST_SERVICE_INSTALL: Record<
  string,
  {
    script: string;
    kind: "mail" | "ftp" | "bind" | "nginx" | "php" | "postgres" | "backup";
    /** systemd unit to enable after the install script (optional). */
    enableUnit?: string;
  }
> = {
  postfix: { script: "install-mail.sh", kind: "mail" },
  dovecot: { script: "install-mail.sh", kind: "mail" },
  ftp: { script: "install-ftp.sh", kind: "ftp" },
  dns: { script: "install-bind.sh", kind: "bind" },
  nginx: { script: "install-nginx.sh", kind: "nginx" },
  "php-fpm": { script: "install-php-fpm.sh", kind: "php" },
  postgresql: { script: "install-postgres.sh", kind: "postgres" },
  "backup-timer": {
    script: "install-backup-worker.sh",
    kind: "backup",
    enableUnit: "naviyra-backup.timer",
  },
};

const ID_SET = new Set(HOST_SERVICE_CATALOG.map((s) => s.id));
const UNIT_RE = /^[a-zA-Z0-9:_.@+-]+\.(service|timer)$/;

export function assertHostServiceId(raw: unknown): string {
  const id = String(raw ?? "").trim();
  if (!ID_SET.has(id)) throw new Error("Unknown service");
  return id;
}

export function assertHostServiceOp(raw: unknown): HostServiceOp {
  const op = String(raw ?? "").trim();
  if (op !== "start" && op !== "stop" && op !== "restart") {
    throw new Error("Use start, stop, or restart");
  }
  return op;
}

function catalogById(id: string): HostServiceDef {
  const def = HOST_SERVICE_CATALOG.find((s) => s.id === id);
  if (!def) throw new Error("Unknown service");
  return def;
}

async function systemctl(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec("systemctl", args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
    };
  }
}

async function unitLoadState(unit: string): Promise<string> {
  if (!UNIT_RE.test(unit)) throw new Error("Invalid unit name");
  const r = await systemctl(["show", unit, "-p", "LoadState", "--value"]);
  return r.stdout.trim() || "not-found";
}

function unitFileOnDisk(unit: string): boolean {
  if (!UNIT_RE.test(unit)) return false;
  const paths = [
    `/etc/systemd/system/${unit}`,
    `/lib/systemd/system/${unit}`,
    `/usr/lib/systemd/system/${unit}`,
  ];
  return paths.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

async function pickUnit(def: HostServiceDef): Promise<string | null> {
  for (const unit of def.units) {
    const load = await unitLoadState(unit);
    if (load !== "not-found" && load !== "error" && load !== "bad-setting") {
      return unit;
    }
    if (unitFileOnDisk(unit)) return unit;
  }
  return def.units[0] ?? null;
}

function defaultAgentListenPort(): number {
  return process.platform === "linux" ? 4100 : 4000;
}

function agentPortsToProbe(): number[] {
  const fromUrl = process.env.AGENT_URL?.match(/:(\d+)(?:\/|$)/)?.[1];
  const raw = process.env.AGENT_PORT || fromUrl || String(defaultAgentListenPort());
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? [n] : [];
}

function tcpOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(600, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function agentBundledWithPanel(): Promise<boolean> {
  for (const port of agentPortsToProbe()) {
    if (await tcpOpen(port)) return true;
  }
  return false;
}

async function readStatus(
  def: HostServiceDef,
  dryRun: boolean
): Promise<HostServiceStatus> {
  const unit = (await pickUnit(def)) || def.units[0] || "";
  if (isWindows || dryRun) {
    return {
      id: def.id,
      name: def.name,
      group: def.group,
      detail: def.detail,
      kind: def.kind,
      unit,
      installed: true,
      active: false,
      enabled: false,
      state: "dry-run",
      allowStop: def.allowStop,
      dryRun: true,
      installable: Boolean(HOST_SERVICE_INSTALL[def.id]),
    };
  }
  const load = await unitLoadState(unit);
  let installed =
    (load !== "not-found" && load !== "error") || unitFileOnDisk(unit);
  let activeR = await systemctl(["is-active", unit]);
  let enabledR = await systemctl(["is-enabled", unit]);
  let active = activeR.stdout.trim() === "active";
  let enabledState = enabledR.stdout.trim();
  let enabled = enabledState === "enabled" || enabledState === "enabled-runtime";
  let state = installed ? activeR.stdout.trim() || "unknown" : "not-installed";
  let allowStop = def.allowStop;
  let displayUnit = unit;
  let detail = def.detail;

  if (def.id === "agent" && !installed && (await agentBundledWithPanel())) {
    installed = true;
    active = true;
    enabled = true;
    state = "active (with panel)";
    allowStop = false;
    displayUnit = "naviyra-panel.service";
    detail =
      "Agent is running inside the panel process. Restart Hosting panel to recycle it. Stop is disabled.";
  }

  return {
    id: def.id,
    name: def.name,
    group: def.group,
    detail,
    kind: def.kind,
    unit: displayUnit,
    installed,
    active,
    enabled,
    state,
    allowStop,
    dryRun: false,
    installable: Boolean(HOST_SERVICE_INSTALL[def.id]),
  };
}

function zoneApexFromHost(host: string): string {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.split(":")[0]
    ?.replace(/^www\./, "") ?? "";
  const parts = h.split(".").filter(Boolean);
  if (parts.length >= 3) return parts.slice(1).join(".");
  return h;
}

function installScriptArgs(kind: (typeof HOST_SERVICE_INSTALL)[string]["kind"]): string[] {
  const env = process.env;
  if (kind === "mail") {
    const host = (env.PANEL_HOSTNAME || "").trim();
    const ip = (env.SERVER_PUBLIC_IP || "").trim();
    const args: string[] = [];
    if (host) args.push(host.replace(/^https?:\/\//, "").split("/")[0] || host);
    if (ip) args.push(ip);
    return args;
  }
  if (kind === "bind") {
    const ip = (env.SERVER_PUBLIC_IP || "").trim();
    const apex =
      (env.BASE_DOMAIN || "").trim() ||
      zoneApexFromHost(env.PANEL_HOSTNAME || env.PANEL_PUBLIC_URL || "");
    if (!ip || !apex) {
      throw new Error(
        "Installing BIND needs SERVER_PUBLIC_IP and PANEL_HOSTNAME (or BASE_DOMAIN) in .env"
      );
    }
    return [ip, apex];
  }
  if (kind === "postgres" || kind === "backup") {
    return [PANEL_ROOT];
  }
  return [];
}

export async function installHostService(input: {
  id: string;
  dryRun: boolean;
}): Promise<HostServiceStatus> {
  const id = assertHostServiceId(input.id);
  const spec = HOST_SERVICE_INSTALL[id];
  if (!spec) {
    throw new Error(`${id} cannot be installed from the panel`);
  }
  const def = catalogById(id);
  if (isWindows || input.dryRun) {
    return readStatus(def, true);
  }
  const current = await readStatus(def, false);
  if (current.installed) {
    return current;
  }

  const scriptsDir = path.resolve(PANEL_ROOT, "scripts");
  if (path.basename(spec.script) !== spec.script || !spec.script.endsWith(".sh")) {
    throw new Error("Invalid install script");
  }
  const scriptPath = path.resolve(scriptsDir, spec.script);
  const rel = path.relative(scriptsDir, scriptPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid install script path");
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Install script missing: ${spec.script}`);
  }

  const args = installScriptArgs(spec.kind);
  try {
    await exec("/bin/bash", [scriptPath, ...args], {
      timeout: 900_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    });
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const detail = String(err.stderr || err.stdout || err.message || "install failed").trim();
    throw new Error(detail.slice(-2000) || `Failed to install ${def.name}`);
  }

  if (spec.enableUnit && UNIT_RE.test(spec.enableUnit)) {
    await systemctl(["daemon-reload"]);
    const enable = await systemctl(["enable", "--now", spec.enableUnit]);
    if (enable.code !== 0) {
      throw new Error(
        enable.stderr.trim() || `Installed but failed to enable ${spec.enableUnit}`
      );
    }
  }

  return readStatus(def, false);
}

export async function listHostServices(input: {
  dryRun: boolean;
}): Promise<{ services: HostServiceStatus[]; dryRun: boolean }> {
  const services: HostServiceStatus[] = [];
  for (const def of HOST_SERVICE_CATALOG) {
    services.push(await readStatus(def, input.dryRun));
  }
  return { services, dryRun: input.dryRun || isWindows };
}

export async function controlHostService(input: {
  id: string;
  op: HostServiceOp;
  dryRun: boolean;
}): Promise<HostServiceStatus> {
  const id = assertHostServiceId(input.id);
  const op = assertHostServiceOp(input.op);
  const def = catalogById(id);
  if (op === "stop" && !def.allowStop) {
    throw new Error(
      `${def.name} cannot be stopped from the panel. Use Restart if you need to recycle it.`
    );
  }
  if (isWindows || input.dryRun) {
    return readStatus(def, true);
  }
  const unit = await pickUnit(def);
  if (!unit) throw new Error("No systemd unit configured");
  const load = await unitLoadState(unit);
  if (load === "not-found" || load === "error") {
    if (id === "agent" && (await agentBundledWithPanel())) {
      if (op === "stop") {
        throw new Error(
          "The agent runs inside the panel process and cannot be stopped separately. Restart Hosting panel to recycle it."
        );
      }
      if (op === "restart" || op === "start") {
        const restart = await systemctl(["restart", "naviyra-panel.service"]);
        if (restart.code !== 0) {
          throw new Error(restart.stderr.trim() || "Failed to restart naviyra-panel.service");
        }
        return readStatus(def, false);
      }
    }
    throw new Error(`${def.name} is not installed on this host (${unit})`);
  }

  if (def.kind === "timer") {
    if (op === "start") {
      const enable = await systemctl(["enable", "--now", unit]);
      if (enable.code !== 0) {
        throw new Error(enable.stderr.trim() || `Failed to start ${unit}`);
      }
      for (const extra of def.alsoStart ?? []) {
        if (UNIT_RE.test(extra)) await systemctl(["start", extra]);
      }
    } else if (op === "stop") {
      const disable = await systemctl(["disable", "--now", unit]);
      if (disable.code !== 0) {
        throw new Error(disable.stderr.trim() || `Failed to stop ${unit}`);
      }
    } else {
      const restart = await systemctl(["restart", unit]);
      if (restart.code !== 0) {
        throw new Error(restart.stderr.trim() || `Failed to restart ${unit}`);
      }
      for (const extra of def.alsoStart ?? []) {
        if (UNIT_RE.test(extra)) await systemctl(["start", extra]);
      }
    }
  } else if (op === "start") {
    await systemctl(["enable", unit]);
    const start = await systemctl(["start", unit]);
    if (start.code !== 0) {
      throw new Error(start.stderr.trim() || `Failed to start ${unit}`);
    }
  } else if (op === "stop") {
    const stop = await systemctl(["stop", unit]);
    if (stop.code !== 0) {
      throw new Error(stop.stderr.trim() || `Failed to stop ${unit}`);
    }
  } else {
    const restart = await systemctl(["restart", unit]);
    if (restart.code !== 0) {
      throw new Error(restart.stderr.trim() || `Failed to restart ${unit}`);
    }
  }

  return readStatus(def, false);
}
