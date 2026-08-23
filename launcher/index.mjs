#!/usr/bin/env node
/**
 * Naviyra Panel — cross-platform launcher (Windows + Linux + macOS)
 *
 * Usage:
 *   node launcher/index.mjs          Start panel + agent
 *   node launcher/index.mjs start    Same as above
 *   node launcher/index.mjs stop     Stop panel + agent
 *   node launcher/index.mjs start --no-browser   Start without opening browser (Linux servers)
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  hasAdminPermission,
  getPermissionLabel,
  getAdminGuidance,
} from "./permissions.mjs";
import {
  getPrismaCli,
  getTsxCli,
  isDatabaseInitialized,
  isPackagedApp,
  isPrismaClientReady,
} from "./db.mjs";
import { needsShell, resolveNpmCommand, resolveNpxCommand } from "./spawn-utils.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.NAVIYRA_ROOT
  ? path.resolve(process.env.NAVIYRA_ROOT)
  : path.join(__dirname, "..");

// Load .env before reading ports
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: path.join(ROOT, ".env") });
} catch {
  /* dotenv optional during first install */
}

if (!process.env.AGENT_PORT && process.env.AGENT_URL) {
  try {
    const parsed = new URL(process.env.AGENT_URL);
    if (parsed.port) process.env.AGENT_PORT = parsed.port;
  } catch {
    /* ignore invalid AGENT_URL */
  }
}

const DATA_DIR = path.join(ROOT, "data");
const ENV_FILE = path.join(ROOT, ".env");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const PID_FILE = path.join(ROOT, "data", "naviyra.pid");

const args = process.argv.slice(2);
const command = args[0] === "start" || args[0] === "stop" ? args.shift() : "start";
const noBrowser = args.includes("--no-browser");

const PANEL_PORT = Number(process.env.PANEL_PORT || 3000);
const AGENT_PORT = Number(
  process.env.AGENT_PORT || (process.platform === "linux" ? 4100 : 4000)
);
const PANEL_URL = `http://localhost:${PANEL_PORT}`;

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";
const platformName = isWindows ? "Windows" : isLinux ? "Linux" : isMac ? "macOS" : process.platform;

if (!process.env.NODE_ENV) {
  const live = process.env.AGENT_DRY_RUN === "false";
  process.env.NODE_ENV = live || isLinux ? "production" : "development";
}

const npmCmd = isWindows ? "npm.cmd" : "npm";
const npxCmd = isWindows ? "npx.cmd" : "npx";

const children = [];

function log(msg) {
  console.log(`[Naviyra] ${msg}`);
}

function banner() {
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║       NAVIYRA HOSTING PANEL          ║");
  console.log(`  ║   ${platformName.padEnd(33)}║`);
  console.log("  ║   Start once · Control via browser   ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");
}

function ensureEnv() {
  if (!fs.existsSync(ENV_FILE) && fs.existsSync(ENV_EXAMPLE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    log("Created .env file");
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    log("Created data/ folder for database");
  }
}

function defaultAgentDryRun() {
  if (process.env.AGENT_DRY_RUN !== undefined) {
    return process.env.AGENT_DRY_RUN === "true";
  }
  // Windows: safe dry-run. Linux/macOS: real server operations by default.
  return isWindows;
}

function shouldOpenBrowser() {
  if (noBrowser) return false;
  if (process.env.NAVIYRA_NO_BROWSER === "true") return false;
  // Headless Linux (no GUI)
  if (isLinux && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false;
  }
  return true;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let finalCmd = cmd;
    let finalArgs = args;
    let shell = opts.shell ?? needsShell(cmd);

    if (cmd === npmCmd) {
      const resolved = resolveNpmCommand(args, opts);
      finalCmd = resolved.cmd;
      finalArgs = resolved.args;
      shell = resolved.shell;
    } else if (cmd === npxCmd) {
      const resolved = resolveNpxCommand(args, opts);
      finalCmd = resolved.cmd;
      finalArgs = resolved.args;
      shell = resolved.shell;
    }

    const child = spawn(finalCmd, finalArgs, {
      cwd: opts.cwd ?? ROOT,
      stdio: opts.silent ? "pipe" : "inherit",
      shell,
      env: { ...process.env, ...opts.env },
    });
    if (!opts.detached) children.push(child);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || opts.ignoreExit) resolve();
      else reject(new Error(`${finalCmd} ${finalArgs.join(" ")} exited with ${code}`));
    });
  });
}

function spawnService(name, cmd, args, opts = {}) {
  log(`Starting ${name}...`);
  let finalCmd = cmd;
  let finalArgs = args;
  let shell = opts.shell ?? needsShell(cmd);

  if (cmd === npmCmd) {
    const resolved = resolveNpmCommand(args, opts);
    finalCmd = resolved.cmd;
    finalArgs = resolved.args;
    shell = resolved.shell;
  } else if (cmd === npxCmd) {
    const resolved = resolveNpxCommand(args, opts);
    finalCmd = resolved.cmd;
    finalArgs = resolved.args;
    shell = resolved.shell;
  }

  const child = spawn(finalCmd, finalArgs, {
    cwd: opts.cwd ?? ROOT,
    stdio: "pipe",
    shell,
    detached: !isWindows,
    env: { ...process.env, ...opts.env },
  });

  if (!isWindows) {
    // Own process group on Linux/macOS for clean shutdown
    child.unref();
  }

  children.push(child);

  child.stdout?.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.log(`[${name}] ${line}`);
  });
  child.stderr?.on("data", (d) => {
    const line = d.toString().trim();
    if (line && !line.includes("ExperimentalWarning")) {
      console.error(`[${name}] ${line}`);
    }
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      log(`${name} stopped (code ${code})`);
    }
  });

  return child;
}

async function runPrisma(args) {
  const prismaCli = getPrismaCli(ROOT);
  if (prismaCli) {
    await run(process.execPath, [prismaCli, ...args]);
    return;
  }
  await run(npxCmd, ["prisma", ...args]);
}

async function runSeed() {
  const seedScript = path.join(ROOT, "prisma", "seed.ts");
  const tsxCli = getTsxCli(ROOT);
  if (tsxCli && fs.existsSync(seedScript)) {
    await run(process.execPath, [tsxCli, seedScript], { cwd: ROOT, ignoreExit: true });
    return;
  }
  await run(npmCmd, ["run", "db:seed"], { ignoreExit: true });
}

async function setupDatabase() {
  log("Preparing database...");
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

  const packaged = isPackagedApp(ROOT);
  const clientReady = isPrismaClientReady(ROOT);
  const dbReady = isDatabaseInitialized(ROOT);

  if (packaged && clientReady && dbReady) {
    log("Database ready.");
    return;
  }

  if (!clientReady) {
    await runPrisma(["generate"]);
  } else if (packaged) {
    log("Using bundled Prisma client.");
  }

  if (!dbReady) {
    await runPrisma(["db", "push"]);
    await runSeed();
    return;
  }

  if (!packaged) {
    await runPrisma(["db", "push"]);
    await runSeed();
  }
}

function waitForUrl(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
        } else {
          setTimeout(check, 1000);
        }
      });
    };
    check();
  });
}

function openBrowser(url) {
  try {
    if (isWindows) {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    } else if (isMac) {
      spawn("open", [url], { detached: true, stdio: "ignore" });
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    }
  } catch {
    log(`Open manually: ${url}`);
  }
}

function killProcess(pid, signal = "SIGTERM") {
  try {
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], { shell: true });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already dead */
    }
  }
}

function killByPort(port) {
  if (isWindows) {
    const result = spawnSync("netstat", ["-ano"], { encoding: "utf8", shell: true });
    const lines = (result.stdout || "").split("\n");
    for (const line of lines) {
      if (line.includes(`:${port} `) && line.includes("LISTENING")) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== "0") {
          spawnSync("taskkill", ["/pid", pid, "/f", "/t"], { shell: true });
        }
      }
    }
  } else {
    const result = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" });
    const pids = (result.stdout || "").trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
}

function writePidFile() {
  const pids = children.map((c) => c.pid).filter(Boolean);
  fs.writeFileSync(PID_FILE, JSON.stringify({ pids, panelPort: PANEL_PORT, agentPort: AGENT_PORT }, null, 2));
}

function stopAll() {
  log("Stopping Naviyra Panel...");

  if (fs.existsSync(PID_FILE)) {
    try {
      const { pids } = JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
      for (const pid of pids ?? []) {
        killProcess(pid);
      }
      fs.unlinkSync(PID_FILE);
    } catch {
      /* fall through to port-based stop */
    }
  }

  killByPort(PANEL_PORT);
  killByPort(AGENT_PORT);
  log("Stopped.");
}

function shutdown() {
  log("Shutting down...");
  for (const child of children) {
    if (child.pid) killProcess(child.pid);
  }
  killByPort(PANEL_PORT);
  killByPort(AGENT_PORT);
  if (fs.existsSync(PID_FILE)) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 500);
}

async function ensureDependencies() {
  if (isPackagedApp(ROOT)) {
    if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
      throw new Error("Application files are incomplete. Reinstall Naviyra Panel.");
    }
    return;
  }

  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    log("First run — installing dependencies (one time)...");
    await run(npmCmd, ["install"]);
  }
  if (!fs.existsSync(path.join(ROOT, "agent", "node_modules"))) {
    log("Installing agent dependencies...");
    await run(npmCmd, ["install"], { cwd: path.join(ROOT, "agent") });
  }
}

function checkNode() {
  const major = Number(process.version.slice(1).split(".")[0]);
  if (major < 20) {
    console.error(`[Naviyra] Node.js 20+ required. You have ${process.version}`);
    process.exit(1);
  }
}

async function startApp() {
  banner();
  checkNode();
  process.chdir(ROOT);
  ensureEnv();
  await ensureDependencies();
  await setupDatabase();

  const dryRun = defaultAgentDryRun();
  const isAdmin = hasAdminPermission();
  log(`Agent mode: ${dryRun ? "dry-run (simulated)" : "live (real server commands)"}`);
  log(`Permissions: ${getPermissionLabel()}`);
  log(getAdminGuidance(!dryRun));

  if (!dryRun && !isAdmin) {
    console.log("");
    console.log("  ⚠  WARNING: Live mode requires admin/root privileges.");
    if (isWindows) {
      console.log("     Use: Start Naviyra Panel (Admin).bat");
    } else {
      console.log("     Use: sudo ./start-admin.sh");
    }
    console.log("");
  }

  const useProduction = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
  const panelArgs = useProduction ? ["run", "start"] : ["run", "dev:panel"];
  const agentUrl = process.env.AGENT_URL?.trim() || `http://127.0.0.1:${AGENT_PORT}`;

  if (!useProduction) {
    log("Running in development mode (run 'npm run build' for production)");
  }

  const tsxCli = getTsxCli(ROOT);
  const agentEntry = path.join(ROOT, "agent", "index.ts");
  const agentEnv = {
    AGENT_PORT: String(AGENT_PORT),
    AGENT_URL: agentUrl,
    AGENT_API_KEY: process.env.AGENT_API_KEY || "",
    AGENT_DRY_RUN: dryRun ? "true" : "false",
    AGENT_BIND_HOST: process.env.AGENT_BIND_HOST || "127.0.0.1",
  };

  if (tsxCli && fs.existsSync(agentEntry)) {
    const agentArgs = useProduction
      ? [tsxCli, agentEntry]
      : [tsxCli, "watch", agentEntry];
    spawnService("Agent", process.execPath, agentArgs, {
      cwd: path.join(ROOT, "agent"),
      env: agentEnv,
    });
  } else {
    spawnService("Agent", npmCmd, ["run", useProduction ? "start" : "dev"], {
      cwd: path.join(ROOT, "agent"),
      env: agentEnv,
    });
  }

  spawnService("Panel", npmCmd, panelArgs, {
    env: {
      PORT: String(PANEL_PORT),
      // next start binds to process.env.HOSTNAME (systemd sets the machine name).
      HOSTNAME: "0.0.0.0",
      AGENT_PORT: String(AGENT_PORT),
      AGENT_URL: agentUrl,
    },
  });

  writePidFile();

  log(`Waiting for panel at ${PANEL_URL}...`);
  try {
    await waitForUrl(PANEL_URL);
    if (shouldOpenBrowser()) {
      log("Panel ready! Opening browser...");
      openBrowser(PANEL_URL);
    } else {
      log("Panel ready! (headless — open the URL below in your browser)");
    }
    console.log("");
    console.log("  ┌─────────────────────────────────────────────┐");
    console.log(`  │  Web control panel:  ${PANEL_URL.padEnd(22)}│`);
    console.log(`  │  Server agent:       http://localhost:${String(AGENT_PORT).padEnd(5)}│`);
    console.log(`  │  Platform:          ${platformName.padEnd(22)}│`);
    console.log(`  │  Permissions:      ${getPermissionLabel().padEnd(22)}│`);
    console.log("  │                                             │");
    console.log("  │  Keep this terminal open while using the app│");
    console.log("  │  Press Ctrl+C to stop                       │");
    console.log("  │  Or run: npm run stop                       │");
    console.log("  └─────────────────────────────────────────────┘");
    console.log("");
  } catch (err) {
    log(`Panel did not start: ${err.message}`);
    log("Check errors above. Open the URL manually if the panel is running.");
  }
}

if (command === "stop") {
  stopAll();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startApp().catch((err) => {
  console.error("[Naviyra] Fatal error:", err.message);
  shutdown();
});
