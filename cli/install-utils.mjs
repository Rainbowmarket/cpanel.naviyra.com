import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { FIXED_DEFAULTS, SECRET_KEYS } from "./env-fields.mjs";

export const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SKIP_COPY_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "data",
  "sites",
  ".cursor",
  "Output",
  "coverage",
  ".turbo",
]);

export const SKIP_COPY_FILES = new Set([".env", ".env.local", ".env.production"]);

export function packageRootFromCli() {
  const bundled = path.join(CLI_DIR, "panel", "package.json");
  if (fs.existsSync(bundled)) return path.join(CLI_DIR, "panel");
  return path.resolve(CLI_DIR, "..");
}

export function defaultInstallDir() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || "C:\\", "NaviyraPanel");
  }
  return "/opt/naviyra-panel";
}

export function isPanelInstall(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return (
    fs.existsSync(path.join(dir, "launcher", "index.mjs")) &&
    fs.existsSync(path.join(dir, "package.json"))
  );
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function panelVersion(root) {
  const pkg = readJson(path.join(root, "package.json"), {});
  return pkg.version || "0.0.0";
}

export function generateSecret() {
  return crypto.randomBytes(32).toString("hex");
}

export function log(msg) {
  const prefix = useColor() ? `${ANSI.green}[naviyra]${ANSI.reset}` : "[naviyra]";
  console.log(`${prefix} ${msg}`);
}

export function logOk(msg) {
  const tag = useColor() ? `${ANSI.green}  ✓${ANSI.reset}` : "  [ok]";
  console.log(`${tag} ${msg}`);
}

export function logFail(msg) {
  const tag = useColor() ? `${ANSI.red}  ✗${ANSI.reset}` : "  [fail]";
  console.log(`${tag} ${msg}`);
}

const ANSI = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

function useColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function systemctlQuiet(args) {
  return spawnSync("systemctl", args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function unitActive(unit) {
  return systemctlQuiet(["is-active", "--quiet", unit]).status === 0;
}

function unitFailed(unit) {
  return systemctlQuiet(["is-failed", "--quiet", unit]).status === 0;
}

function unitLoaded(unit) {
  const r = systemctlQuiet(["show", "-p", "LoadState", "--value", unit]);
  return (r.stdout || "").trim() === "loaded";
}

function portListening(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1) return false;
  const r = spawnSync(
    "bash",
    ["-c", `timeout 1 bash -c "echo >/dev/tcp/127.0.0.1/${n}" 2>/dev/null`],
    { encoding: "utf8", windowsHide: true }
  );
  return r.status === 0;
}

function waitForPort(port, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (portListening(port)) return true;
    sleepMs(1000);
  }
  return portListening(port);
}

function printCheck(ok, name, detail) {
  const color = useColor();
  if (ok) {
    const badge = color ? `${ANSI.green}${ANSI.bold}running${ANSI.reset}` : "running";
    const extra = detail ? (color ? ` ${ANSI.dim}${detail}${ANSI.reset}` : ` ${detail}`) : "";
    console.log(`  ${badge}   ${name}${extra}`);
    return;
  }
  const badge = color ? `${ANSI.red}${ANSI.bold}stopped${ANSI.reset}` : "stopped";
  const extra = detail ? (color ? ` ${ANSI.red}${detail}${ANSI.reset}` : ` ${detail}`) : "";
  console.log(`  ${badge}   ${name}${extra}`);
}

/**
 * After Linux install/upgrade: wait for the panel port, then print green/red service status.
 */
export function printLinuxInstallStatus(dest) {
  if (process.platform !== "linux") return;
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    log("Skip service status (not root).");
    return;
  }

  const env = parseEnvFile(path.join(dest, ".env"));
  const port = env.PANEL_PORT || "3100";
  const title = useColor() ? `${ANSI.bold}Service status${ANSI.reset}` : "Service status";
  console.log("");
  console.log(`  ${title}`);
  console.log("  ──────────────");

  if (unitLoaded("naviyra-panel.service") || fs.existsSync("/etc/systemd/system/naviyra-panel.service")) {
    log(`Waiting for panel on 127.0.0.1:${port}…`);
    waitForPort(port, 25000);
  }

  if (portListening(port) && fs.existsSync("/etc/systemd/system/naviyra-visitor-ingest.service")) {
    spawnSync("systemctl", ["start", "naviyra-visitor-ingest.service"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: "ignore",
    });
  }

  const panelUp = unitActive("naviyra-panel.service");
  const portUp = portListening(port);
  printCheck(panelUp, "naviyra-panel.service", panelUp ? "systemd" : "systemctl status naviyra-panel");
  printCheck(portUp, `panel port :${port}`, portUp ? "127.0.0.1" : "not listening");

  const checks = [
    ["nginx.service", "nginx"],
    ["postgresql.service", "PostgreSQL"],
    ["naviyra-visitor-ingest.timer", "visitor ingest timer"],
    ["naviyra-expire-blocks.timer", "auto-block expiry timer"],
  ];
  for (const [unit, label] of checks) {
    if (!unitLoaded(unit) && !fs.existsSync(`/etc/systemd/system/${unit}`)) {
      printCheck(false, label, `${unit} not installed`);
      continue;
    }
    const ok = unitActive(unit);
    const failed = unitFailed(unit);
    printCheck(ok, `${label} (${unit})`, failed && !ok ? "failed" : ok ? "" : "inactive");
  }

  if (unitLoaded("naviyra-visitor-ingest.service") || fs.existsSync("/etc/systemd/system/naviyra-visitor-ingest.service")) {
    if (unitFailed("naviyra-visitor-ingest.service")) {
      printCheck(false, "visitor ingest last run", "will retry next minute");
    } else {
      printCheck(true, "visitor ingest last run", "ok or not yet due");
    }
  }

  if (unitLoaded("naviyra-backup.timer") || fs.existsSync("/etc/systemd/system/naviyra-backup.timer")) {
    const ok = unitActive("naviyra-backup.timer");
    const badge = ok
      ? useColor()
        ? `${ANSI.green}${ANSI.bold}running${ANSI.reset}`
        : "running"
      : useColor()
        ? `${ANSI.yellow}${ANSI.bold}off    ${ANSI.reset}`
        : "off";
    console.log(`  ${badge}   backup timer (enable from Admin → Backups)`);
  }

  const nginxTest = spawnSync("nginx", ["-t"], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (fs.existsSync("/etc/nginx/nginx.conf")) {
    printCheck(nginxTest.status === 0, "nginx -t", nginxTest.status === 0 ? "config ok" : "config failed");
  }

  console.log("");
}

export function banner() {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════╗");
  console.log("  ║     NAVIYRA HOSTING PANEL — npm installer    ║");
  console.log("  ║     npx naviyra-hosting-pannel               ║");
  console.log("  ╚══════════════════════════════════════════════╝");
  console.log("");
}

export function createRl() {
  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY),
  });
  // Pipes/files would be consumed (and the interface closed) during async work
  // such as public-IP lookup if we leave stdin flowing.
  if (!input.isTTY) rl.pause();
  return rl;
}

export async function ask(rl, question, { defaultValue = "", required = false, secret = false, validate } = {}) {
  const suffix = defaultValue !== "" && defaultValue != null ? ` [${defaultValue}]` : "";
  for (;;) {
    let answer;
    if (!input.isTTY) rl.resume();
    if (secret) {
      rl.pause();
      try {
        answer = (await askHidden(`${question}${suffix}: `)).trim();
      } finally {
        if (!input.isTTY) rl.pause();
        else rl.resume();
      }
    } else {
      answer = (await rl.question(`${question}${suffix}: `)).trim();
      if (!input.isTTY) rl.pause();
    }
    if (!answer && defaultValue !== "" && defaultValue != null) answer = String(defaultValue);
    if (!answer && !required) return "";
    if (!answer && required) {
      console.log("  This value is required.");
      continue;
    }
    if (validate) {
      const err = validate(answer);
      if (err) {
        console.log(`  ${err}`);
        continue;
      }
    }
    return answer;
  }
}

function askHidden(promptText) {
  return new Promise((resolve, reject) => {
    output.write(promptText);
    if (!input.isTTY) {
      let acc = "";
      const onData = (chunk) => {
        acc += chunk.toString("utf8");
        if (acc.includes("\n") || acc.includes("\r")) {
          input.off("data", onData);
          resolve(acc.replace(/[\r\n]/g, ""));
        }
      };
      input.on("data", onData);
      return;
    }
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    let buf = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      if (s === "\n" || s === "\r" || s === "\u0004") {
        cleanup();
        output.write("\n");
        resolve(buf);
        return;
      }
      if (s === "\u0003") {
        cleanup();
        output.write("\n");
        reject(new Error("Cancelled"));
        return;
      }
      if (s === "\u0008" || s === "\u007f") {
        buf = buf.slice(0, -1);
        return;
      }
      if (s >= " ") buf += s;
    };
    const cleanup = () => {
      input.off("data", onData);
      if (input.isTTY) input.setRawMode(Boolean(wasRaw));
    };
    input.on("data", onData);
  });
}

export async function askYesNo(rl, question, defaultYes = false) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseEnvText(fs.readFileSync(filePath, "utf8"));
}

export function applyEnvValues(exampleText, values) {
  let text = exampleText;
  const seen = new Set();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const encoded = encodeEnvValue(key, value);
    const re = new RegExp(`^#?\\s*${escapeRegExp(key)}=.*$`, "m");
    if (re.test(text)) {
      text = text.replace(re, `${key}=${encoded}`);
    } else {
      text += `\n${key}=${encoded}\n`;
    }
    seen.add(key);
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

function encodeEnvValue(key, value) {
  const raw = String(value);
  if (key === "BIND_RELOAD_CMD") {
    return raw.startsWith('"') ? raw : `"${raw.replace(/^"|"$/g, "")}"`;
  }
  if (/[\s#]/.test(raw) && !/^".*"$/.test(raw)) {
    return `"${raw.replace(/"/g, '\\"')}"`;
  }
  return raw;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function writeEnvFile(destDir, values, examplePath) {
  const example = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf8")
    : "";
  const merged = { ...FIXED_DEFAULTS, ...values };
  const text = applyEnvValues(example, merged);
  fs.writeFileSync(path.join(destDir, ".env"), text, { encoding: "utf8", mode: 0o600 });
}

export function mergeNewEnvKeys(existingText, exampleText) {
  const existing = parseEnvText(existingText);
  let text = existingText.endsWith("\n") ? existingText : `${existingText}\n`;
  const added = [];
  for (const raw of exampleText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const key = line.split("=", 1)[0].trim();
    if (!key || key in existing) continue;
    text += `${raw}\n`;
    added.push(key);
  }
  return { text, added };
}

const UNIX_TEXT_EXT = new Set([".sh", ".bash", ".service", ".timer", ".conf"]);

function isUnixTextPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return UNIX_TEXT_EXT.has(ext);
}

function writeCopiedFile(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (!isUnixTextPath(destPath)) {
    fs.copyFileSync(srcPath, destPath);
    return;
  }
  const text = fs.readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  fs.writeFileSync(destPath, text, { encoding: "utf8" });
  if (destPath.endsWith(".sh") || destPath.endsWith(".bash")) {
    try {
      fs.chmodSync(destPath, 0o755);
    } catch {
      /* Windows */
    }
  }
}

/** Strip CR so bash on Linux does not see `$'\r': command not found`. */
export function normalizeUnixTextFiles(root) {
  if (!root || !fs.existsSync(root)) return 0;
  let changed = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_COPY_NAMES.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !isUnixTextPath(full)) continue;
      const orig = fs.readFileSync(full, "utf8");
      const next = orig.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (next !== orig) {
        fs.writeFileSync(full, next, { encoding: "utf8" });
        changed += 1;
      }
      if (full.endsWith(".sh") || full.endsWith(".bash")) {
        try {
          fs.chmodSync(full, 0o755);
        } catch {
          /* Windows */
        }
      }
    }
  }
  if (changed) log(`Normalized ${changed} script(s) to Unix line endings.`);
  return changed;
}

export function copyPanelFiles(src, dest, { overwriteEnv = false } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  copyDir(src, dest, (rel, entry) => {
    if (entry.isDirectory() && SKIP_COPY_NAMES.has(entry.name)) return false;
    if (SKIP_COPY_FILES.has(entry.name) && !overwriteEnv) return false;
    if (rel.split(path.sep)[0] === "cli" && entry.name === "panel") return false;
    return true;
  });
  normalizeUnixTextFiles(path.join(dest, "scripts"));
}

function copyDir(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const rel = path.relative(src, srcPath);
    if (filter && !filter(rel, entry)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else if (entry.isFile()) {
      writeCopiedFile(srcPath, destPath);
    }
  }
}

export function run(cmd, args, opts = {}) {
  const isWin = process.platform === "win32";
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: opts.stdio ?? "inherit",
    shell: opts.shell ?? (isWin && /\.(cmd|bat)$/i.test(cmd)),
    env: { ...process.env, ...opts.env },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !opts.ignoreExit) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status})`);
  }
  return result;
}

export function resolveNpm() {
  if (process.platform === "win32") return "npm.cmd";
  return "npm";
}

export function resolveNpx() {
  if (process.platform === "win32") return "npx.cmd";
  return "npx";
}

/** Panel requires current Node LTS (20+). Prefer nvm's latest LTS over Ubuntu's /usr/bin/node. */
export const NODE_MAJOR_MIN = 20;

let cachedPanelNode = null;

export function nodeMajor(version = process.versions.node) {
  const n = Number(String(version).replace(/^v/, "").split(".")[0]);
  return Number.isFinite(n) ? n : 0;
}

export function panelNodePaths(nodeBin) {
  let resolved = nodeBin;
  try {
    resolved = fs.realpathSync(nodeBin);
  } catch {
    /* keep given path */
  }
  const binDir = path.dirname(resolved);
  const npmName = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmBin = path.join(binDir, npmName);
  const ver = spawnSync(resolved, ["-v"], { encoding: "utf8" });
  return {
    node: resolved,
    npm: fs.existsSync(npmBin) ? npmBin : resolveNpm(),
    binDir,
    version: (ver.stdout || "").trim() || `v${process.versions.node}`,
  };
}

function findNvm() {
  if (process.platform === "win32") return null;
  const dirs = [process.env.NVM_DIR, path.join(os.homedir(), ".nvm")];
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    dirs.push("/root/.nvm");
  }
  for (const dir of dirs) {
    if (!dir) continue;
    const sh = path.join(dir, "nvm.sh");
    if (fs.existsSync(sh)) return { dir, sh };
  }
  return null;
}

function nvmEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;
  return env;
}

function nvmBash(nvm, snippet, opts = {}) {
  return spawnSync(
    "bash",
    [
      "-c",
      `unset npm_config_prefix
unset NPM_CONFIG_PREFIX
export NVM_DIR=${JSON.stringify(nvm.dir)}
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
${snippet}`,
    ],
    {
      encoding: "utf8",
      stdio: opts.stdio ?? "inherit",
      env: nvmEnv({ NVM_DIR: nvm.dir }),
    }
  );
}

/** Install latest Node LTS with nvm and return its absolute path, or null. */
function nvmInstallLts(nvm) {
  log("nvm: installing latest LTS if it is not already present…");
  const install = nvmBash(nvm, "nvm install --lts && nvm use --lts");
  if (install.status !== 0) return null;
  const which = nvmBash(nvm, "nvm use --lts >/dev/null && command -v node", {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bin = (which.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
  if (bin && fs.existsSync(bin)) return bin;
  return null;
}

function installNvmLinux() {
  const dir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  log(`Installing nvm into ${dir}…`);
  const result = spawnSync(
    "bash",
    [
      "-c",
      `export NVM_DIR=${JSON.stringify(dir)}
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`,
    ],
    { encoding: "utf8", stdio: "inherit", env: nvmEnv({ NVM_DIR: dir }) }
  );
  if (result.status !== 0) return null;
  const sh = path.join(dir, "nvm.sh");
  return fs.existsSync(sh) ? { dir, sh } : null;
}

/**
 * Pick the Node binary the panel will install with and run under systemd.
 * Prefer nvm latest LTS (install it if missing). Never prefer Ubuntu's older /usr/bin/node
 * when nvm is available — that mismatch is what breaks better-sqlite3.
 */
export function ensurePanelNode() {
  if (cachedPanelNode) return cachedPanelNode;

  if (process.platform !== "win32") {
    const nvm = findNvm();
    if (nvm) {
      const bin = nvmInstallLts(nvm);
      if (bin) {
        cachedPanelNode = panelNodePaths(bin);
        if (nodeMajor(cachedPanelNode.version) >= NODE_MAJOR_MIN) {
          log(`Panel Node ${cachedPanelNode.version} via nvm (${cachedPanelNode.node})`);
          return cachedPanelNode;
        }
      }
      log("nvm was found but latest LTS could not be used; falling back to the current Node.");
    }
  }

  if (nodeMajor() >= NODE_MAJOR_MIN) {
    cachedPanelNode = panelNodePaths(process.execPath);
    log(`Panel Node ${cachedPanelNode.version} (${cachedPanelNode.node})`);
    return cachedPanelNode;
  }

  if (process.platform === "linux") {
    log(`Node ${process.version} is too old. Installing nvm + latest LTS…`);
    const nvm = findNvm() || installNvmLinux();
    if (nvm) {
      const bin = nvmInstallLts(nvm);
      if (bin) {
        cachedPanelNode = panelNodePaths(bin);
        if (nodeMajor(cachedPanelNode.version) >= NODE_MAJOR_MIN) {
          log(`Panel Node ${cachedPanelNode.version} via nvm (${cachedPanelNode.node})`);
          return cachedPanelNode;
        }
      }
    }
  }

  throw new Error(
    `Node.js ${NODE_MAJOR_MIN}+ is required (found v${process.versions.node}). ` +
      "Install nvm (https://github.com/nvm-sh/nvm) and run: nvm install --lts && nvm use --lts"
  );
}

/** @deprecated Use ensurePanelNode — kept so older staged CLIs still import this name. */
export function ensureNode20() {
  ensurePanelNode();
}

export async function detectPublicIp() {
  const urls = ["https://api.ipify.org", "https://ifconfig.me/ip"];
  for (const url of urls) {
    try {
      const ip = (await fetchText(url, 4000)).trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch {
      /* try next */
    }
  }
  return "";
}

function fetchText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location, timeoutMs).then(resolve, reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function sqlitePathsFromUrl(dest, url) {
  const raw = String(url || "").trim();
  if (!raw.startsWith("file:")) return [];
  let filePath = raw.slice("file:".length);
  if (filePath.startsWith("///")) filePath = filePath.slice(2);
  else if (filePath.startsWith("//")) filePath = filePath.slice(1);
  if (!path.isAbsolute(filePath)) filePath = path.resolve(dest, filePath);
  return [filePath, `${filePath}-wal`, `${filePath}-shm`];
}

/** Delete the panel SQLite DB so the next install shows first-time admin setup. */
export function removePanelDatabase(dest, env = {}) {
  const files = new Set([
    ...sqlitePathsFromUrl(dest, env.DATABASE_URL),
    ...sqlitePathsFromUrl(dest, "file:./data/naviyra.db"),
  ]);
  let removed = 0;
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    fs.rmSync(file, { force: true });
    log(`Removed panel database ${file}`);
    removed += 1;
  }
  const dataDir = path.join(dest, "data");
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    log(`Removed panel data directory ${dataDir}`);
    removed += 1;
  }
  if (!removed) log("No panel SQLite database found.");
}

function postgresIdent(name) {
  if (!/^n_[a-z0-9_]+$/.test(name)) return null;
  return `"${name}"`;
}

function findPsqlBin() {
  const candidates = ["/usr/bin/psql", "/usr/local/bin/psql"];
  try {
    const versions = fs.readdirSync("/usr/lib/postgresql").sort().reverse();
    for (const ver of versions) {
      candidates.push(path.join("/usr/lib/postgresql", ver, "bin", "psql"));
    }
  } catch {
    /* no versioned install */
  }
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function psql(sql, { ignoreExit = false } = {}) {
  const bin = findPsqlBin();
  if (!bin) {
    return { ok: false, stdout: "", stderr: "psql not found" };
  }
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "--", bin, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8", windowsHide: true }
  );
  if (result.error || (result.status !== 0 && !ignoreExit)) {
    return { ok: false, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
  }
  return { ok: true, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
}

/** Drop PostgreSQL databases/roles the panel created (`n_<hash>_<label>`). */
export function dropHostedPostgresDatabases() {
  if (process.platform !== "linux") {
    log("Skipping hosted PostgreSQL cleanup (Linux only).");
    return;
  }
  const listed = psql(
    "SELECT datname FROM pg_database WHERE datname LIKE 'n\\_%' ESCAPE '\\' ORDER BY 1",
    { ignoreExit: true }
  );
  if (!listed.ok) {
    log("PostgreSQL not available, or cannot list panel databases (skipped).");
    return;
  }
  const names = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => postgresIdent(name));
  if (!names.length) {
    log("No panel-created PostgreSQL databases found.");
    return;
  }
  for (const name of names) {
    const ident = postgresIdent(name);
    const escaped = name.replace(/'/g, "''");
    psql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${escaped}' AND pid <> pg_backend_pid()`,
      { ignoreExit: true }
    );
    const dropped = psql(`DROP DATABASE IF EXISTS ${ident}`);
    if (!dropped.ok) {
      log(`Could not drop PostgreSQL database ${name}${dropped.stderr ? `: ${dropped.stderr}` : ""}`);
      continue;
    }
    psql(`DROP ROLE IF EXISTS ${ident}`, { ignoreExit: true });
    log(`Dropped PostgreSQL database and role ${name}`);
  }
}

export function writeInstallMeta(dest, extra = {}) {
  const meta = {
    name: "naviyra-hosting-pannel",
    version: panelVersion(dest),
    installedAt: extra.installedAt || new Date().toISOString(),
    upgradedAt: extra.upgradedAt || null,
    ...extra,
  };
  fs.writeFileSync(path.join(dest, ".naviyra-install.json"), JSON.stringify(meta, null, 2) + "\n");
}

export function findExistingInstall({ dirFlag, cwd = process.cwd() } = {}) {
  const candidates = [];
  if (dirFlag) candidates.push(path.resolve(dirFlag));
  candidates.push(cwd, defaultInstallDir());
  if (process.platform !== "win32") {
    candidates.push(path.join(os.homedir(), "naviyra-panel"));
  }
  for (const dir of candidates) {
    if (isPanelInstall(dir)) return dir;
  }
  return null;
}

export function systemdUnitExists() {
  return fs.existsSync("/etc/systemd/system/naviyra-panel.service");
}

function unlinkQuiet(file) {
  try {
    if (file && fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function listNaviyraSystemdUnits() {
  const units = new Set();
  const dirs = ["/etc/systemd/system", "/lib/systemd/system", "/usr/lib/systemd/system"];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("naviyra-")) continue;
      if (!name.endsWith(".service") && !name.endsWith(".timer")) continue;
      units.add(name);
    }
  }
  return [...units].sort();
}

export function hasNaviyraSystemArtifacts() {
  if (process.platform !== "linux") return false;
  if (listNaviyraSystemdUnits().length) return true;
  const files = [
    "/etc/nginx/conf.d/naviyra-visitors.conf",
    "/etc/nginx/conf.d/naviyra-websocket-map.conf",
    "/etc/nginx/naviyra-blocked-ips.conf",
  ];
  if (files.some((file) => fs.existsSync(file))) return true;
  for (const dir of ["/etc/nginx/conf.d", "/etc/nginx/snippets"]) {
    if (!fs.existsSync(dir)) continue;
    try {
      if (fs.readdirSync(dir).some((name) => name.startsWith("naviyra-"))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function stripNaviyraNginxDirectives(text) {
  return String(text || "")
    .replace(/log_format\s+naviyra_visitors\b[\s\S]*?;/g, "")
    .replace(/[ \t]*access_log\s+\S+\s+naviyra_visitors\s*;[ \t]*\n?/g, "")
    .replace(/[ \t]*access_log\s+\S*naviyra-visitors\.log\S*[ \t]*[^;]*;[ \t]*\n?/g, "")
    .replace(/[ \t]*include\s+\/etc\/nginx\/snippets\/naviyra-[^;]+;[ \t]*\n?/g, "")
    .replace(/[ \t]*include\s+\/etc\/nginx\/naviyra-blocked-ips\.conf\s*;[ \t]*\n?/g, "");
}

function patchNginxFile(file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const orig = fs.readFileSync(file, "utf8");
  const next = stripNaviyraNginxDirectives(orig);
  if (next === orig) return false;
  fs.writeFileSync(file, next);
  log(`Stripped Naviyra nginx directives from ${file}`);
  return true;
}

function removeNginxSitePair(siteName) {
  if (!siteName) return;
  const safe = String(siteName).replace(/[/\\]/g, "");
  if (!safe || safe === "default") return;
  for (const dir of ["/etc/nginx/sites-enabled", "/etc/nginx/sites-available"]) {
    unlinkQuiet(path.join(dir, safe));
  }
}

function walkNginxConfigs(onFile) {
  const roots = [
    "/etc/nginx/nginx.conf",
    "/etc/nginx/conf.d",
    "/etc/nginx/snippets",
    "/etc/nginx/sites-available",
    "/etc/nginx/sites-enabled",
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const st = fs.statSync(root);
    if (st.isFile()) {
      onFile(root);
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const name of fs.readdirSync(root)) {
      const file = path.join(root, name);
      try {
        if (fs.statSync(file).isFile()) onFile(file);
      } catch {
        /* ignore */
      }
    }
  }
}

function isNaviyraManagedVhost(file, text, panelHosts) {
  const name = path.basename(file);
  if (panelHosts.has(name.toLowerCase())) return true;
  if (name.startsWith("naviyra-")) return true;
  if (/#\s*Naviyra Panel\b/i.test(text)) return true;
  if (/include\s+\/etc\/nginx\/snippets\/naviyra-/.test(text)) return true;
  return false;
}

function leftoverUsesConnectionUpgrade() {
  let found = false;
  walkNginxConfigs((file) => {
    if (path.basename(file) === "naviyra-websocket-map.conf") return;
    try {
      if (fs.readFileSync(file, "utf8").includes("$connection_upgrade")) found = true;
    } catch {
      /* ignore */
    }
  });
  return found;
}

function restoreWebsocketMapIfNeeded() {
  if (!leftoverUsesConnectionUpgrade()) return;
  const dest = "/etc/nginx/conf.d/naviyra-websocket-map.conf";
  fs.mkdirSync("/etc/nginx/conf.d", { recursive: true });
  fs.writeFileSync(
    dest,
    "map $http_upgrade $connection_upgrade {\n    default upgrade;\n    ''      close;\n}\n"
  );
  log(`Restored ${dest} (leftover vhosts still use $connection_upgrade).`);
}

/**
 * Remove systemd units, nginx snippets/vhosts, and visitor logs the panel installed.
 * Does not apt-remove nginx/postgres/bind. Safe to run after the install dir is gone.
 */
export function cleanupLinuxPanelArtifacts({ dest = "", env = {}, removeSites = false } = {}) {
  if (process.platform !== "linux") return;
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    log("Not root — leaving systemd units and nginx files in place. Re-run uninstall as root to finish cleanup.");
    return;
  }

  const units = listNaviyraSystemdUnits();
  if (units.length) {
    log("Stopping and removing systemd units…");
    const timers = units.filter((unit) => unit.endsWith(".timer"));
    const services = units.filter((unit) => unit.endsWith(".service"));
    for (const unit of [...timers, ...services]) {
      run("systemctl", ["stop", unit], { ignoreExit: true });
    }
    for (const unit of timers) {
      run("systemctl", ["disable", unit], { ignoreExit: true });
    }
    for (const unit of services) {
      run("systemctl", ["disable", unit], { ignoreExit: true, stdio: "ignore" });
    }
    for (const dir of ["/etc/systemd/system", "/lib/systemd/system", "/usr/lib/systemd/system"]) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith("naviyra-")) continue;
        unlinkQuiet(path.join(dir, name));
      }
    }
    run("systemctl", ["daemon-reload"], { ignoreExit: true });
    run("systemctl", ["reset-failed"], { ignoreExit: true });
    log(`Removed systemd units: ${units.join(", ")}`);
  }

  if (!fs.existsSync("/etc/nginx")) {
    log("nginx not installed — skipping nginx cleanup.");
    return;
  }

  const panelHosts = new Set();
  const hostname = String(env.PANEL_HOSTNAME || "").trim().toLowerCase();
  if (hostname) {
    panelHosts.add(hostname);
    panelHosts.add(`www.${hostname}`);
  }
  const mailHost = String(env.MAIL_HOSTNAME || "").trim().toLowerCase();
  if (mailHost && !mailHost.includes("{")) panelHosts.add(mailHost);
  else if (hostname) panelHosts.add(`mail.${hostname}`);

  log("Removing Naviyra nginx snippets and visitor log config…");
  for (const dir of ["/etc/nginx/conf.d", "/etc/nginx/snippets"]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith("naviyra-")) continue;
      unlinkQuiet(path.join(dir, name));
      log(`Removed ${path.join(dir, name)}`);
    }
  }
  unlinkQuiet("/etc/nginx/naviyra-blocked-ips.conf");
  for (const logFile of [
    "/var/log/nginx/naviyra-visitors.log",
    "/var/log/nginx/naviyra-visitors.log.1",
  ]) {
    unlinkQuiet(logFile);
  }
  try {
    for (const name of fs.readdirSync("/var/log/nginx")) {
      if (name.startsWith("naviyra-visitors.log")) unlinkQuiet(path.join("/var/log/nginx", name));
    }
  } catch {
    /* ignore */
  }

  for (const host of panelHosts) {
    removeNginxSitePair(host);
    log(`Removed panel nginx site ${host}`);
    unlinkQuiet(`/etc/nginx/ssl/${host}.crt`);
    unlinkQuiet(`/etc/nginx/ssl/${host}.key`);
  }

  walkNginxConfigs((file) => {
    const base = path.basename(file);
    if (base === "default" || base.endsWith(".bak")) {
      patchNginxFile(file);
      return;
    }
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    if (
      /#\s*Naviyra Panel\b/i.test(text) ||
      /include\s+\/etc\/nginx\/snippets\/naviyra-terminal-ws\.conf/.test(text)
    ) {
      removeNginxSitePair(base);
      log(`Removed panel nginx site ${base}`);
      return;
    }
    const managed = isNaviyraManagedVhost(file, text, panelHosts);
    if (removeSites && managed && /\/sites-(available|enabled)\//.test(file.replace(/\\/g, "/"))) {
      removeNginxSitePair(base);
      log(`Removed hosted nginx site ${base}`);
      return;
    }
    patchNginxFile(file);
  });

  if (removeSites) {
    removeTreeSafe("/var/www/naviyra-errors", "error pages");
  }
  removeTreeSafe("/var/backups/naviyra", "panel backup directory");

  restoreWebsocketMapIfNeeded();

  const test = spawnSync("nginx", ["-t"], { encoding: "utf8", windowsHide: true });
  if (test.status === 0) {
    run("systemctl", ["reload", "nginx"], { ignoreExit: true });
    log("nginx reloaded after cleanup.");
  } else {
    const err = `${test.stderr || ""} ${test.stdout || ""}`;
    if (/connection_upgrade/.test(err)) {
      restoreWebsocketMapIfNeeded();
      const retry = spawnSync("nginx", ["-t"], { encoding: "utf8", windowsHide: true });
      if (retry.status === 0) {
        run("systemctl", ["reload", "nginx"], { ignoreExit: true });
        log("nginx reloaded after restoring WebSocket map.");
        return;
      }
    }
    log(`nginx -t failed after cleanup${err.trim() ? `: ${err.trim().split("\n").slice(-3).join(" | ")}` : ""}`);
  }
}

function removeTreeSafe(dir, label) {
  if (!dir || !fs.existsSync(dir)) return;
  const resolved = path.resolve(dir);
  const blocked = new Set(["/", "/var", "/etc", "/usr", "/bin", "/home", "/opt", "/root", "/var/www", "/var/log", "/var/backups"]);
  if (blocked.has(resolved) || resolved === path.parse(resolved).root) {
    log(`Refusing to delete ${resolved}`);
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  log(`Removed ${label}: ${resolved}`);
}

export function ensureSecrets(values) {
  const next = { ...values };
  for (const key of SECRET_KEYS) {
    const cur = String(next[key] || "").trim();
    const weak =
      !cur ||
      cur.length < 24 ||
      cur.startsWith("naviyra-local") ||
      ["change-me", "secret", "password"].includes(cur);
    if (weak) next[key] = generateSecret();
  }
  return next;
}
