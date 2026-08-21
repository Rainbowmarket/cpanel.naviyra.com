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

export type AppType = "STATIC" | "PHP" | "PYTHON" | "GO" | "NODE";

export function isProxyAppType(appType: string | undefined | null): boolean {
  return appType === "PYTHON" || appType === "GO" || appType === "NODE";
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
    let t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (/^export\s+/i.test(t)) t = t.replace(/^export\s+/i, "");
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function siteDotEnvPaths(documentRoot: string, workingDir: string): string[] {
  const paths = [path.join(path.resolve(documentRoot), ".env")];
  const wd = path.join(path.resolve(workingDir), ".env");
  if (wd !== paths[0]) paths.push(wd);
  return paths;
}

function readFileIfPresent(file: string): string {
  try {
    if (!fsSync.existsSync(file)) return "";
    return fsSync.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function assertNoSuperuserDbUser(env: Record<string, string>) {
  const keys = ["DB_USER", "POSTGRES_USER", "PGUSER", "DATABASE_USER"];
  for (const key of keys) {
    const value = (env[key] || "").trim().toLowerCase();
    if (value === "postgres" || value === "root") {
      throw new Error(
        "Do not use DB_USER=postgres. Use the database name from Databases as both DB_USER and DB_NAME."
      );
    }
  }
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
  // Always honor an explicit in-range port (may already be bound by this app).
  if (
    preferred &&
    preferred >= APP_PORT_MIN &&
    preferred <= APP_PORT_MAX
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

const RESOLVE_BINS = new Set([
  "node",
  "nodejs",
  "python3",
  "python",
  "uvicorn",
  "gunicorn",
  "go",
]);

async function resolveBin(name: string): Promise<string> {
  if (name === "node" || name === "nodejs") {
    return process.execPath;
  }
  try {
    const { stdout } = await exec("which", [name]);
    const found = stdout.trim();
    if (found) return found;
  } catch {
    /* ignore */
  }
  for (const candidate of [`/usr/bin/${name}`, `/usr/local/bin/${name}`]) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return name;
}

async function resolveStartCommandBins(command: string): Promise<string> {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return command;
  const bin = parts[0];
  if (!bin.startsWith("/") && !bin.startsWith(".") && RESOLVE_BINS.has(bin)) {
    parts[0] = await resolveBin(bin);
  }
  const resolved = parts[0];
  const isPython =
    /(^|\/)python3?$/.test(resolved) || bin === "python" || bin === "python3";
  if (isPython && parts[1] !== "-u" && parts[1] !== "-m") {
    parts.splice(1, 0, "-u");
  }
  return parts.join(" ");
}

async function chmodLocalBinary(
  command: string,
  workingDir: string,
  documentRoot: string
) {
  const bin = command.trim().split(/\s+/).filter(Boolean)[0];
  if (!bin || bin.startsWith("/")) return;
  const abs = path.resolve(workingDir, bin);
  try {
    assertPathUnderRoot(abs, documentRoot);
    const st = await fs.stat(abs);
    if (st.isFile()) await fs.chmod(abs, 0o755);
  } catch {
    /* not a file in the app root */
  }
}

function servicePathEnv(extraBin?: string): string {
  const nodeDir = path.dirname(process.execPath);
  const extra = extraBin ? `${extraBin}:` : "";
  return `${extra}${nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
}

async function runChecked(
  bin: string,
  args: string[],
  timeout = 180000
): Promise<void> {
  try {
    await exec(bin, args, { timeout, maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const detail = [err.stderr, err.stdout, err.message]
      .filter(Boolean)
      .join("\n")
      .slice(-1500);
    throw new Error(detail || `Command failed: ${bin} ${args.join(" ")}`);
  }
}

/** Create site .venv and install requirements / uvicorn so systemd is not stuck on system python3. */
async function ensurePythonVenv(
  workingDir: string,
  command: string,
  dryRun: boolean
): Promise<{ command: string; venvBin?: string }> {
  const usesPython =
    /\b(python3?|uvicorn|gunicorn)\b/.test(command) ||
    command.includes("-m uvicorn");
  if (!usesPython) return { command };

  const venvDir = path.join(workingDir, ".venv");
  const venvPython = path.join(venvDir, "bin", "python");
  const venvBin = path.join(venvDir, "bin");

  if (dryRun || isWindows) {
    return {
      command: command.replace(
        /^(python3|python)\b/,
        path.join(".venv", "bin", "python")
      ),
      venvBin: path.join(".venv", "bin"),
    };
  }

  if (!fsSync.existsSync(venvPython)) {
    await runChecked("python3", ["-m", "venv", venvDir], 120000);
  }

  const req = path.join(workingDir, "requirements.txt");
  if (fsSync.existsSync(req)) {
    await runChecked(venvPython, ["-m", "pip", "install", "-r", req], 300000);
  }
  if (/\buvicorn\b/.test(command) || command.includes("-m uvicorn")) {
    await runChecked(
      venvPython,
      ["-m", "pip", "install", "uvicorn", "fastapi"],
      180000
    );
  }

  let next = command
    .replace(/^(python3|python)\b/, venvPython)
    .replace(/^\/usr\/bin\/python3\b/, venvPython);
  if (next.startsWith("uvicorn ")) {
    next = `${venvPython} -m ${next}`;
  }
  return { command: next, venvBin };
}

function ensureLongRunningPythonCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (/\b(uvicorn|gunicorn|hypercorn|daphne)\b/.test(trimmed)) return trimmed;
  const fileMatch = trimmed.match(
    /(?:python3?|python)\s+(?:-u\s+)?(\S+\.py)\s*$/i
  );
  if (fileMatch?.[1]) {
    const file = fileMatch[1].replace(/^[/\\]+/, "");
    const mod = file.replace(/\.py$/i, "").replace(/\\/g, "/").replace(/\//g, ".");
    return `python3 -m uvicorn ${mod}:app --host 127.0.0.1 --port $PORT`;
  }
  return trimmed;
}

function resolveWorkingDir(documentRoot: string, workingDirRel: string): string {
  const raw = (workingDirRel || ".").trim().replace(/\\/g, "/") || ".";
  const root = path.resolve(documentRoot);
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  assertPathUnderRoot(abs, root);
  return abs;
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
  cmd = ensureLongRunningPythonCommand(cmd);
  cmd = cmd
    .replace(/\$\{PORT\}/g, String(opts.port))
    .replace(/\$PORT\b/g, String(opts.port));
  const workingDir = resolveWorkingDir(
    opts.documentRoot,
    opts.workingDirRel || "."
  );

  if (!opts.dryRun && !isWindows) {
    await chmodLocalBinary(cmd, workingDir, opts.documentRoot);
  }
  const py = await ensurePythonVenv(
    workingDir,
    cmd,
    Boolean(opts.dryRun || isWindows)
  );
  cmd = py.command;
  cmd = await resolveStartCommandBins(cmd);

  const unit = unitNameForSite(opts.siteId);
  const fromFiles = parseEnvLines(
    siteDotEnvPaths(opts.documentRoot, workingDir)
      .map((p) => readFileIfPresent(p))
      .join("\n")
  );
  const env = { ...fromFiles, ...parseEnvLines(opts.appEnv) };
  assertNoSuperuserDbUser(env);
  env.PORT = String(opts.port);
  env.HOST = "127.0.0.1";
  env.PYTHONUNBUFFERED = env.PYTHONUNBUFFERED || "1";
  env.PYTHONPATH = env.PYTHONPATH || workingDir;
  env.PATH = servicePathEnv(py.venvBin);

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

export async function getAppLogs(
  siteId: string,
  lines = 80
): Promise<{ unitName: string; logs: string }> {
  const unit = unitNameForSite(siteId);
  if (isWindows) {
    return { unitName: unit, logs: "" };
  }
  try {
    const { stdout, stderr } = await exec("journalctl", [
      "-u",
      unit,
      "-n",
      String(Math.min(200, Math.max(1, lines))),
      "--no-pager",
    ]);
    return { unitName: unit, logs: (stdout || stderr || "").trim() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { unitName: unit, logs: msg };
  }
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
  const unitPath = path.join(UNIT_DIR, unit);
  if (!fsSync.existsSync(unitPath)) {
    throw new Error("Save app settings first so the systemd unit is created");
  }
  await exec("systemctl", ["reset-failed", unit]).catch(() => undefined);
  await exec("systemctl", ["enable", unit]);
  await exec("systemctl", ["restart", unit]);
  await new Promise((r) => setTimeout(r, 1500));
  const active = await isUnitActive(unit);
  if (!active) {
    const { logs } = await getAppLogs(siteId, 50);
    const detail = logs.slice(-1800);
    throw new Error(
      detail
        ? `Service failed to stay running.\n${detail}`
        : "Service failed to stay running"
    );
  }
  return { unitName: unit, active: true };
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
