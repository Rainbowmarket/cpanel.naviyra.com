/**
 * Managed app process helpers (Python / Go) via systemd.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const isWindows = process.platform === "win32";

export const APP_PORT_MIN = 12000;
export const APP_PORT_MAX = 12999;

const UNIT_DIR = "/etc/systemd/system";

export type AppType = "STATIC" | "PHP" | "PYTHON" | "GO";

export function isProxyAppType(appType: string | undefined | null): boolean {
  return appType === "PYTHON" || appType === "GO";
}

export function unitNameForSite(siteId: string): string {
  const safe = siteId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return `naviyra-app-${safe}.service`;
}

export function assertPathUnderRoot(target: string, root: string) {
  const rootReal = path.resolve(root);
  const targetReal = path.resolve(target);
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (targetReal !== rootReal && !targetReal.startsWith(prefix)) {
    throw new Error("Working directory must be under document root");
  }
}

/** Reject shell metacharacters; allow simple argv-style commands. */
export function sanitizeStartCommand(cmd: string): string {
  const trimmed = cmd.trim();
  if (!trimmed) throw new Error("Start command is required");
  if (trimmed.length > 500) throw new Error("Start command too long");
  // Allow $PORT / ${PORT} placeholders (substituted before ExecStart).
  const withoutPortPlaceholders = trimmed
    .replace(/\$\{PORT\}/g, "PORT")
    .replace(/\$PORT\b/g, "PORT");
  if (/[;&|<>`$\\\n\r]/.test(withoutPortPlaceholders)) {
    throw new Error(
      "Start command must not contain shell metacharacters (;|&<>`$\\). Use a direct binary and args. $PORT is allowed."
    );
  }
  return trimmed;
}

function parseEnvLines(appEnv?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!appEnv?.trim()) return out;
  for (const line of appEnv.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function allocateUpstreamPort(
  preferred?: number | null
): Promise<number> {
  if (
    preferred &&
    preferred >= APP_PORT_MIN &&
    preferred <= APP_PORT_MAX &&
    (await portFree(preferred))
  ) {
    return preferred;
  }
  for (let p = APP_PORT_MIN; p <= APP_PORT_MAX; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error("No free upstream ports in range 12000-12999");
}

function systemdEscapeArg(arg: string): string {
  if (/^[a-zA-Z0-9_./:@%=+-]+$/.test(arg)) return arg;
  return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildExecStart(command: string): string {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error("Empty start command");
  return parts.map(systemdEscapeArg).join(" ");
}

export async function writeAppUnit(opts: {
  siteId: string;
  documentRoot: string;
  workingDirRel: string;
  startCommand: string;
  port: number;
  appEnv?: string | null;
  dryRun?: boolean;
}): Promise<{ unitName: string; workingDir: string }> {
  let cmd = sanitizeStartCommand(opts.startCommand);
  cmd = cmd
    .replace(/\$\{PORT\}/g, String(opts.port))
    .replace(/\$PORT\b/g, String(opts.port));
  const rel = (opts.workingDirRel || ".").replace(/\\/g, "/");
  const workingDir = path.resolve(opts.documentRoot, rel);
  assertPathUnderRoot(workingDir, opts.documentRoot);

  const unit = unitNameForSite(opts.siteId);
  const env = parseEnvLines(opts.appEnv);
  env.PORT = String(opts.port);
  env.HOST = "127.0.0.1";

  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment=${k}=${systemdEscapeArg(v)}`)
    .join("\n");

  const content = `[Unit]
Description=Naviyra app ${opts.siteId}
After=network.target

[Service]
Type=simple
WorkingDirectory=${workingDir}
ExecStart=${buildExecStart(cmd)}
${envLines}
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  if (opts.dryRun || isWindows) {
    console.log(`[DRY RUN] write unit ${unit}\n${content}`);
    return { unitName: unit, workingDir };
  }

  await fs.mkdir(UNIT_DIR, { recursive: true });
  await fs.writeFile(path.join(UNIT_DIR, unit), content, "utf8");
  await exec("systemctl", ["daemon-reload"]);
  return { unitName: unit, workingDir };
}

export async function startAppUnit(
  siteId: string,
  dryRun = false
): Promise<{ unitName: string; active: boolean }> {
  const unit = unitNameForSite(siteId);
  if (dryRun || isWindows) {
    console.log(`[DRY RUN] systemctl enable --now ${unit}`);
    return { unitName: unit, active: true };
  }
  await exec("systemctl", ["enable", "--now", unit]);
  const active = await isUnitActive(unit);
  return { unitName: unit, active };
}

export async function stopAppUnit(
  siteId: string,
  dryRun = false
): Promise<{ unitName: string }> {
  const unit = unitNameForSite(siteId);
  if (dryRun || isWindows) {
    console.log(`[DRY RUN] systemctl disable --now ${unit}`);
    return { unitName: unit };
  }
  await exec("systemctl", ["disable", "--now", unit]).catch(() => undefined);
  return { unitName: unit };
}

export async function restartAppUnit(
  siteId: string,
  dryRun = false
): Promise<{ unitName: string; active: boolean }> {
  const unit = unitNameForSite(siteId);
  if (dryRun || isWindows) {
    console.log(`[DRY RUN] systemctl restart ${unit}`);
    return { unitName: unit, active: true };
  }
  await exec("systemctl", ["restart", unit]);
  const active = await isUnitActive(unit);
  return { unitName: unit, active };
}

async function isUnitActive(unit: string): Promise<boolean> {
  try {
    const { stdout } = await exec("systemctl", ["is-active", unit]);
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

export async function getAppUnitStatus(siteId: string): Promise<{
  unitName: string;
  active: boolean;
  exists: boolean;
}> {
  const unit = unitNameForSite(siteId);
  if (isWindows) {
    return { unitName: unit, active: false, exists: false };
  }
  const unitPath = path.join(UNIT_DIR, unit);
  const exists = fsSync.existsSync(unitPath);
  const active = exists ? await isUnitActive(unit) : false;
  return { unitName: unit, active, exists };
}

export async function removeAppUnit(
  siteId: string,
  dryRun = false
): Promise<void> {
  const unit = unitNameForSite(siteId);
  if (dryRun || isWindows) {
    console.log(`[DRY RUN] remove ${unit}`);
    return;
  }
  await exec("systemctl", ["disable", "--now", unit]).catch(() => undefined);
  await fs.rm(path.join(UNIT_DIR, unit), { force: true });
  await exec("systemctl", ["daemon-reload"]).catch(() => undefined);
}
