#!/usr/bin/env node
/**
 * npx naviyra-hosting-pannel
 * npx naviyra-hosting-pannel install
 * npx naviyra-hosting-pannel upgrade
 *
 * Interactive installer: prompts for the same keys as .env.example,
 * copies the panel, writes .env, installs deps, and can upgrade in place.
 */

import fs from "node:fs";
import path from "node:path";
import {
  INSTALL_STEPS,
  derivedFromDomain,
  defaultAgentUrl,
} from "./env-fields.mjs";
import {
  ask,
  askYesNo,
  banner,
  copyPanelFiles,
  createRl,
  defaultInstallDir,
  detectPublicIp,
  cleanupLinuxPanelArtifacts,
  dropHostedPostgresDatabases,
  ensurePanelNode,
  ensureSecrets,
  findExistingInstall,
  hasNaviyraSystemArtifacts,
  isPanelInstall,
  log,
  mergeNewEnvKeys,
  normalizeUnixTextFiles,
  packageRootFromCli,
  panelVersion,
  parseEnvFile,
  printLinuxInstallStatus,
  removePanelDatabase,
  run,
  systemdUnitExists,
  writeEnvFile,
  writeInstallMeta,
} from "./install-utils.mjs";

const SOURCE = packageRootFromCli();

function printHelp() {
  console.log(`
Naviyra Hosting Panel — npm installer

Usage:
  npx naviyra-hosting-pannel              Interactive menu
  npx naviyra-hosting-pannel install      New install (prompts for .env values)
  npx naviyra-hosting-pannel upgrade      Upgrade an existing install (keeps .env + data)
  npx naviyra-hosting-pannel reconfigure  Re-run the .env wizard on an existing install
  npx naviyra-hosting-pannel uninstall    Stop services, remove nginx/systemd leftovers, delete the panel database and install directory
  npx naviyra-hosting-pannel status       Show green/red systemd + nginx + panel port status


Options:
  --dir <path>     Install / upgrade / uninstall directory
  --yes            Accept derived defaults (still asks required domain + IP)
  --help           Show this help

Examples:
  npx naviyra-hosting-pannel
  npx naviyra-hosting-pannel install --dir /opt/naviyra-panel
  npx naviyra-hosting-pannel upgrade --dir /opt/naviyra-panel
  npx naviyra-hosting-pannel uninstall --dir /opt/naviyra-panel

Node: Linux installs use nvm’s latest LTS when nvm is present (nvm install --lts
if that version is missing). systemd ExecStart is that same Node binary.
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { yes: false, dir: "", help: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--dir" || a === "--prefix") flags.dir = args[++i] || "";
    else if (a.startsWith("--dir=")) flags.dir = a.slice("--dir=".length);
    else if (!a.startsWith("-")) positional.push(a);
    else {
      console.error(`Unknown option: ${a}`);
      flags.help = true;
    }
  }
  let command = positional[0] || "";
  if (command === "install" && positional[1] && !positional[1].startsWith("-")) {
    // allow: npx naviyra-hosting-pannel install (people type this from "npx install …")
  }
  if (!command && positional.length === 0) command = "";
  return { command, flags };
}

async function promptInstallValues(rl, { yes, existing = {} }) {
  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  const detectedIp = existing.SERVER_PUBLIC_IP || (await detectPublicIp());
  const defaultPanelPort = existing.PANEL_PORT || (isLinux ? "3100" : "3000");
  const defaultAgentPort = existing.AGENT_PORT || (isLinux ? "4100" : "4000");

  console.log("Values match the panel .env file. Examples are shown for each field.\n");

  const domain = await ask(rl, "Panel domain (PANEL_HOSTNAME)\n  Example: hpanel.yourdomain.com  (apex yourdomain.com can be the marketing site)\n ", {
    defaultValue: existing.PANEL_HOSTNAME || "",
    required: true,
    validate: INSTALL_STEPS[0].fields[0].validate,
  });

  const derived = derivedFromDomain(domain);

  const ip = await ask(rl, "Server public IPv4 (SERVER_PUBLIC_IP)\n  Example: 203.0.113.10\n  Used for DNS A records\n ", {
    defaultValue: existing.SERVER_PUBLIC_IP || detectedIp || "",
    required: true,
    validate: INSTALL_STEPS[0].fields[1].validate,
  });

  const values = {
    ...derived,
    SERVER_PUBLIC_IP: ip,
    PANEL_PORT: defaultPanelPort,
    AGENT_PORT: defaultAgentPort,
    AGENT_BIND_HOST: existing.AGENT_BIND_HOST || "127.0.0.1",
    AGENT_DRY_RUN: existing.AGENT_DRY_RUN || (isWin ? "true" : "false"),
    NAVIYRA_NO_BROWSER: existing.NAVIYRA_NO_BROWSER || (isLinux && !process.env.DISPLAY ? "true" : "false"),
    DEPLOY_HOST: existing.DEPLOY_HOST || ip,
    DEPLOY_USER: existing.DEPLOY_USER || "root",
    DEPLOY_PORT: existing.DEPLOY_PORT || "22",
    DEPLOY_PASSWORD: existing.DEPLOY_PASSWORD || "",
    LETSENCRYPT_EMAIL: existing.LETSENCRYPT_EMAIL || derived.LETSENCRYPT_EMAIL,
    COOKIE_SECURE: (existing.PANEL_PUBLIC_URL || derived.PANEL_PUBLIC_URL || "").startsWith("https://")
      ? "true"
      : existing.COOKIE_SECURE,
  };
  values.AGENT_URL = defaultAgentUrl(values.AGENT_PORT);
  values.NEXT_PUBLIC_TERMINAL_WS_URL =
    existing.NEXT_PUBLIC_TERMINAL_WS_URL || derived.NEXT_PUBLIC_TERMINAL_WS_URL;

  if (!yes) {
    values.PANEL_PUBLIC_URL = await ask(rl, "Public panel URL (PANEL_PUBLIC_URL)\n  Example: https://hpanel.yourdomain.com\n ", {
      defaultValue: existing.PANEL_PUBLIC_URL || derived.PANEL_PUBLIC_URL,
      required: true,
    });
    values.DNS_NS1 = await ask(rl, "Primary nameserver (DNS_NS1)\n  Example: ns1.yourdomain.com\n ", {
      defaultValue: existing.DNS_NS1 || derived.DNS_NS1,
      required: true,
    });
    values.DNS_NS2 = await ask(rl, "Secondary nameserver (DNS_NS2)\n  Example: ns2.yourdomain.com\n ", {
      defaultValue: existing.DNS_NS2 || derived.DNS_NS2,
      required: true,
    });
    values.DEFAULT_SERVER_HOSTNAME = await ask(
      rl,
      "Default server hostname (DEFAULT_SERVER_HOSTNAME)\n  Example: s1.yourdomain.com\n ",
      { defaultValue: existing.DEFAULT_SERVER_HOSTNAME || derived.DEFAULT_SERVER_HOSTNAME, required: true }
    );
    values.MAIL_HOSTNAME = await ask(rl, "Mail hostname template (MAIL_HOSTNAME)\n  Example: mail.{domain}\n ", {
      defaultValue: existing.MAIL_HOSTNAME || derived.MAIL_HOSTNAME,
      required: true,
    });
    values.MAIL_FROM = await ask(rl, "System mail From (MAIL_FROM)\n  Example: noreply@yourdomain.com\n  SPF must include this server IP or Gmail will reject mail.\n ", {
      defaultValue: existing.MAIL_FROM || derived.MAIL_FROM,
      required: true,
    });
    values.LETSENCRYPT_EMAIL = await ask(rl, "Let's Encrypt email (LETSENCRYPT_EMAIL)\n  Example: admin@yourdomain.com\n ", {
      defaultValue: values.LETSENCRYPT_EMAIL,
      required: false,
    });

    console.log("\n— Ports & agent —\n");
    if (isLinux) {
      console.log("  Production nginx for this panel usually proxies HTTPS → 127.0.0.1:3100.");
      console.log("  Keep 3100 unless you will update nginx. 3000 is for local testing only.\n");
    }
    values.PANEL_PORT = await ask(rl, `Panel port (PANEL_PORT)\n  Example: ${isLinux ? "3100" : "3000"}\n `, {
      defaultValue: values.PANEL_PORT,
      required: true,
      validate: INSTALL_STEPS[2].fields[0].validate,
    });
    values.AGENT_PORT = await ask(rl, `Agent port (AGENT_PORT)\n  Example: ${isLinux ? "4100" : "4000"}\n `, {
      defaultValue: values.AGENT_PORT,
      required: true,
      validate: INSTALL_STEPS[2].fields[1].validate,
    });
    values.AGENT_URL = defaultAgentUrl(values.AGENT_PORT);
    values.AGENT_BIND_HOST = await ask(rl, "Agent bind host (AGENT_BIND_HOST)\n  Example: 127.0.0.1\n ", {
      defaultValue: values.AGENT_BIND_HOST,
      required: true,
    });
    values.AGENT_URL = await ask(rl, "Agent URL (AGENT_URL)\n  Example: http://127.0.0.1:4000\n ", {
      defaultValue: defaultAgentUrl(values.AGENT_PORT),
      required: true,
    });
    values.AGENT_DRY_RUN = await ask(
      rl,
      "Dry-run mode (AGENT_DRY_RUN)\n  Example: false   (true = simulate; false = live hosting on Linux)\n ",
      { defaultValue: values.AGENT_DRY_RUN, required: true, validate: INSTALL_STEPS[2].fields[4].validate }
    );
    values.NAVIYRA_NO_BROWSER = await ask(
      rl,
      "Headless / no browser (NAVIYRA_NO_BROWSER)\n  Example: true on a VPS without a desktop\n ",
      { defaultValue: values.NAVIYRA_NO_BROWSER, required: true, validate: INSTALL_STEPS[2].fields[5].validate }
    );
  } else {
    log("Using derived DNS/mail/port defaults (--yes).");
  }

  const withSecrets = ensureSecrets({
    ...existing,
    ...values,
    AGENT_API_KEY: existing.AGENT_API_KEY,
    SESSION_SECRET: existing.SESSION_SECRET,
    TWO_FACTOR_ENC_KEY: existing.TWO_FACTOR_ENC_KEY,
  });

  return withSecrets;
}

function printSummary(dir, values) {
  console.log("\nInstall summary");
  console.log("───────────────");
  console.log(`  Directory:     ${dir}`);
  console.log(`  Domain:        ${values.PANEL_HOSTNAME}`);
  console.log(`  Public URL:    ${values.PANEL_PUBLIC_URL}`);
  console.log(`  Server IP:     ${values.SERVER_PUBLIC_IP}`);
  console.log(`  Nameservers:   ${values.DNS_NS1} / ${values.DNS_NS2}`);
  console.log(`  Primary host:  ${values.DEFAULT_SERVER_HOSTNAME}`);
  console.log(`  Mail From:     ${values.MAIL_FROM}`);
  console.log(`  Panel port:    ${values.PANEL_PORT}`);
  console.log(`  Agent port:    ${values.AGENT_PORT}`);
  console.log(`  Dry-run:       ${values.AGENT_DRY_RUN}`);
  console.log("  Secrets:       AGENT_API_KEY, SESSION_SECRET, TWO_FACTOR_ENC_KEY (generated)\n");
}

function panelRuntime() {
  return ensurePanelNode();
}

/** Same Node (nvm LTS or the installer binary) for npm, native rebuilds, and systemd. */
function panelEnv(extra = {}) {
  const rt = panelRuntime();
  const env = {
    ...process.env,
    PATH: `${rt.binDir}${path.delimiter}${process.env.PATH || ""}`,
    ...extra,
  };
  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;
  return env;
}

function runWithServiceNpm(args, dest, extraEnv = {}) {
  const rt = panelRuntime();
  run(rt.npm, args, { cwd: dest, env: panelEnv(extraEnv) });
}

function rebuildBetterSqlite(dest) {
  const rt = panelRuntime();
  log(`Rebuilding better-sqlite3 for ${rt.node} (${rt.version})…`);
  runWithServiceNpm(["rebuild", "better-sqlite3"], dest);
  run(rt.node, ["-e", "require('better-sqlite3')"], { cwd: dest, env: panelEnv() });
  log("better-sqlite3 matches the Node that systemd will run.");
}

function runNpmInstall(dest) {
  log("Installing npm dependencies…");
  runWithServiceNpm(["install", "--include=dev"], dest, { NODE_ENV: "development" });
  log("Ensuring Tailwind CSS (required for production UI)…");
  runWithServiceNpm(["install", "@tailwindcss/postcss", "tailwindcss", "--save"], dest, {
    NODE_ENV: "development",
  });
  const agentDir = path.join(dest, "agent");
  if (fs.existsSync(path.join(agentDir, "package.json"))) {
    runWithServiceNpm(["install"], agentDir);
  }

  const zmSrc = path.join(dest, "scripts", "zeptomatch-cjs");
  const zmDest = path.join(dest, "node_modules", "@prisma", "dev", "node_modules", "zeptomatch");
  if (fs.existsSync(zmSrc)) {
    fs.mkdirSync(path.dirname(zmDest), { recursive: true });
    fs.rmSync(zmDest, { recursive: true, force: true });
    fs.cpSync(zmSrc, zmDest, { recursive: true });
  }

  rebuildBetterSqlite(dest);
}

function runPrisma(dest, { seed }) {
  log("Prisma generate + db push…");
  runWithServiceNpm(["exec", "prisma", "generate"], dest);
  runWithServiceNpm(["exec", "prisma", "db", "push"], dest);
  if (seed) {
    log("Seeding database…");
    run(panelRuntime().npm, ["run", "db:seed"], {
      cwd: dest,
      env: panelEnv(),
      ignoreExit: true,
    });
  }
}

function runBuild(dest) {
  log("Building production panel…");
  runWithServiceNpm(["run", "build"], dest);
}

async function finishLinuxPostgres(dest) {
  if (process.platform !== "linux") return;
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    log("Skipping PostgreSQL (run the installer as root to install it if missing).");
    return;
  }
  const script = path.join(dest, "scripts", "install-postgres.sh");
  if (!fs.existsSync(script)) {
    log("install-postgres.sh missing — skipping PostgreSQL.");
    return;
  }
  log("Ensuring PostgreSQL for customer databases (skips apt if already installed)…");
  fs.chmodSync(script, 0o755);
  run("bash", [script, dest], { cwd: dest });
}

async function finishLinuxWebsocketMap(dest) {
  if (process.platform !== "linux") return;
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    log("Skipping nginx WebSocket map (run the installer as root).");
    return;
  }
  const script = path.join(dest, "scripts", "install-websocket-map.sh");
  if (!fs.existsSync(script)) {
    log("install-websocket-map.sh missing — skipping.");
    return;
  }
  log("Installing nginx WebSocket Connection map…");
  fs.chmodSync(script, 0o755);
  run("bash", [script, dest], { cwd: dest, ignoreExit: true });
}

async function finishLinuxVisitorIngest(dest) {
  if (process.platform !== "linux") return;
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    log("Skipping Security visitor ingest (run the installer as root to enable nginx log ingest).");
    return;
  }
  const script = path.join(dest, "scripts", "install-visitor-ingest.sh");
  if (!fs.existsSync(script)) {
    log("install-visitor-ingest.sh missing — Security visitors will stay empty.");
    return;
  }
  log("Enabling Security visitor ingest (nginx $host logs every minute)…");
  fs.chmodSync(script, 0o755);
  run("bash", [script, dest], { cwd: dest, ignoreExit: true });
}

async function finishLinuxService(dest, rl, flags) {
  if (process.platform !== "linux") return;
  if (typeof process.getuid === "function" && process.getuid() !== 0) return;
  const script = path.join(dest, "scripts", "install-linux-service.sh");
  if (!fs.existsSync(script)) return;
  const install = flags.yes
    ? true
    : await askYesNo(rl, "Install/restart systemd service (naviyra-panel)?", true);
  if (!install) return;
  fs.chmodSync(script, 0o755);
  const rt = panelRuntime();
  // Files/deps/build already ran; only register systemd (omit=dev rebuild strips Tailwind).
  run("bash", [script, dest, "--unit-only"], {
    cwd: dest,
    env: panelEnv({ NODE_BIN: rt.node, NODE_BIN_DIR: rt.binDir }),
  });
  const expireBlocks = path.join(dest, "scripts", "install-expire-auto-blocks.sh");
  if (fs.existsSync(expireBlocks)) {
    fs.chmodSync(expireBlocks, 0o755);
    run("bash", [expireBlocks, dest], { cwd: dest, ignoreExit: true });
  }
  const nginxFix = path.join(dest, "scripts", "fix-naviyra-uk-https.sh");
  if (fs.existsSync(nginxFix)) {
    log("Pointing nginx HTTPS vhost at this PANEL_PORT…");
    fs.chmodSync(nginxFix, 0o755);
    run("bash", [nginxFix], { cwd: dest, ignoreExit: true });
  }
}

async function cmdInstall(rl, flags) {
  const dest = path.resolve(flags.dir || (await ask(rl, "Install directory", { defaultValue: defaultInstallDir(), required: true })));

  if (isPanelInstall(dest) && fs.existsSync(path.join(dest, ".env"))) {
    const up = flags.yes
      ? false
      : await askYesNo(rl, `Panel already exists at ${dest}. Upgrade instead?`, true);
    if (up) {
      flags.dir = dest;
      return cmdUpgrade(rl, flags);
    }
    const overwrite = flags.yes ? false : await askYesNo(rl, "Reinstall and overwrite files?", false);
    if (!overwrite) {
      log("Cancelled.");
      return;
    }
  }

  const values = await promptInstallValues(rl, { yes: flags.yes, existing: parseEnvFile(path.join(dest, ".env")) });
  printSummary(dest, values);
  const ok = flags.yes || (await askYesNo(rl, "Proceed with install?", true));
  if (!ok) {
    log("Cancelled.");
    return;
  }

  if (path.resolve(dest) === path.resolve(SOURCE)) {
    log("Installing in place (this checkout).");
  } else {
    log(`Copying panel files → ${dest}`);
    copyPanelFiles(SOURCE, dest);
  }

  writeEnvFile(dest, values, path.join(dest, ".env.example"));
  const rt = panelRuntime();
  writeInstallMeta(dest, {
    installedAt: new Date().toISOString(),
    nodePath: rt.node,
    nodeVersion: rt.version,
  });
  log("Resetting panel database so the first-time admin setup screen can run…");
  removePanelDatabase(dest, values);
  fs.mkdirSync(path.join(dest, "data"), { recursive: true });

  runNpmInstall(dest);
  runPrisma(dest, { seed: true });
  runBuild(dest);

  normalizeUnixTextFiles(path.join(dest, "scripts"));
  await finishLinuxPostgres(dest);
  await finishLinuxWebsocketMap(dest);
  await finishLinuxVisitorIngest(dest);
  await finishLinuxService(dest, rl, flags);

  const url = values.PANEL_PUBLIC_URL || `http://127.0.0.1:${values.PANEL_PORT || 3000}`;
  console.log("");
  log("Install complete.");
  console.log(`  Open:  ${url}`);
  console.log(`  Files: ${dest}`);
  console.log("  First visit: create the admin account on the Initial setup screen.");
  if (process.platform === "win32") {
    console.log("  Start: npm run app   (from the install directory)");
  } else if (!systemdUnitExists()) {
    console.log("  Start: cd " + dest + " && npm run app");
    console.log("  Or:    sudo ./scripts/install-linux-service.sh " + dest);
  }
  console.log(`  Later: npx naviyra-hosting-pannel upgrade --dir ${dest}`);
  printLinuxInstallStatus(dest);
  console.log("");
}

async function cmdUpgrade(rl, flags) {
  let dest = flags.dir ? path.resolve(flags.dir) : findExistingInstall({ dirFlag: flags.dir });
  if (!dest || !isPanelInstall(dest)) {
    dest = path.resolve(
      await ask(rl, "Existing install directory to upgrade", {
        defaultValue: flags.dir || defaultInstallDir(),
        required: true,
      })
    );
  }
  if (!isPanelInstall(dest)) {
    throw new Error(`No Naviyra panel found at ${dest}. Pass --dir to the install folder.`);
  }

  const fromVer = panelVersion(dest);
  const toVer = panelVersion(SOURCE);
  console.log(`Upgrade ${dest}`);
  console.log(`  Installed: ${fromVer}`);
  console.log(`  Package:   ${toVer}\n`);

  const envPath = path.join(dest, ".env");
  const dataDir = path.join(dest, "data");
  const envBak = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const ok = flags.yes || (await askYesNo(rl, "Copy new files, keep .env + data/, then rebuild?", true));
  if (!ok) {
    log("Cancelled.");
    return;
  }

  if (path.resolve(dest) === path.resolve(SOURCE)) {
    log("Source and destination are the same — skipping file copy.");
  } else {
    log("Updating files (preserving .env and data/)…");
    copyPanelFiles(SOURCE, dest, { overwriteEnv: false });
    if (envBak) fs.writeFileSync(envPath, envBak, { encoding: "utf8", mode: 0o600 });
  }

  if (fs.existsSync(path.join(dest, ".env.example")) && fs.existsSync(envPath)) {
    const merged = mergeNewEnvKeys(fs.readFileSync(envPath, "utf8"), fs.readFileSync(path.join(dest, ".env.example"), "utf8"));
    if (merged.added.length) {
      fs.writeFileSync(envPath, merged.text, { encoding: "utf8", mode: 0o600 });
      log(`Added new .env keys: ${merged.added.join(", ")}`);
    }
  }

  const rt = panelRuntime();
  writeInstallMeta(dest, {
    installedAt: parseInstallMeta(dest).installedAt,
    upgradedAt: new Date().toISOString(),
    previousVersion: fromVer,
    nodePath: rt.node,
    nodeVersion: rt.version,
  });
  fs.mkdirSync(dataDir, { recursive: true });

  runNpmInstall(dest);
  runPrisma(dest, { seed: false });
  runBuild(dest);
  normalizeUnixTextFiles(path.join(dest, "scripts"));
  await finishLinuxPostgres(dest);
  await finishLinuxWebsocketMap(dest);
  await finishLinuxVisitorIngest(dest);
  await finishLinuxService(dest, rl, flags);

  if (systemdUnitExists() && process.platform === "linux" && process.getuid?.() === 0) {
    run("systemctl", ["restart", "naviyra-panel"], { ignoreExit: true });
  }

  log(`Upgrade complete (${fromVer} → ${panelVersion(dest)}).`);
  console.log(`  .env and data/ were kept.`);
  console.log(`  Reconfigure: npx naviyra-hosting-pannel reconfigure --dir ${dest}`);
  printLinuxInstallStatus(dest);
}

function parseInstallMeta(dest) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dest, ".naviyra-install.json"), "utf8"));
  } catch {
    return {};
  }
}

async function cmdReconfigure(rl, flags) {
  let dest = flags.dir ? path.resolve(flags.dir) : findExistingInstall({ dirFlag: flags.dir });
  if (!dest || !isPanelInstall(dest)) {
    dest = path.resolve(
      await ask(rl, "Install directory", { defaultValue: defaultInstallDir(), required: true })
    );
  }
  if (!isPanelInstall(dest)) {
    throw new Error(`No Naviyra panel found at ${dest}.`);
  }
  const existing = parseEnvFile(path.join(dest, ".env"));
  const values = await promptInstallValues(rl, { yes: flags.yes, existing });
  printSummary(dest, values);
  const ok = flags.yes || (await askYesNo(rl, "Write .env with these values?", true));
  if (!ok) {
    log("Cancelled.");
    return;
  }
  writeEnvFile(dest, values, path.join(dest, ".env.example"));
  log(`.env updated at ${path.join(dest, ".env")}`);
  if (systemdUnitExists() && process.getuid?.() === 0) {
    const restart = flags.yes || (await askYesNo(rl, "Restart naviyra-panel systemd service?", true));
    if (restart) run("systemctl", ["restart", "naviyra-panel"], { ignoreExit: true });
  }
}

async function cmdUninstall(rl, flags) {
  let dest = flags.dir ? path.resolve(flags.dir) : findExistingInstall({ dirFlag: flags.dir });
  if (!dest || !isPanelInstall(dest)) {
    dest = path.resolve(
      await ask(rl, "Install directory to uninstall", {
        defaultValue: flags.dir || defaultInstallDir(),
        required: true,
      })
    );
  }
  const hasPanel = isPanelInstall(dest);
  const hasLeftovers = hasNaviyraSystemArtifacts();
  if (!hasPanel && !hasLeftovers) {
    throw new Error(`No Naviyra panel found at ${dest}.`);
  }
  if (!hasPanel) {
    log(`Install directory missing or incomplete at ${dest}; cleaning leftover systemd/nginx files.`);
  }

  const env = parseEnvFile(path.join(dest, ".env"));
  const wwwRoot = process.platform === "win32" ? path.join(dest, "sites") : "/var/www";
  const mailRoot = env.MAIL_VHOSTS_DIR || "/var/mail/vhosts";
  const bindZones = env.BIND_ZONES_DIR || "/etc/bind/zones";
  const bindNamed = env.BIND_NAMED_DIR || "/etc/bind/naviyra-zones.d";
  const bindInclude = env.BIND_INCLUDE_FILE || "/etc/bind/naviyra-zones.conf";

  console.log(
    hasPanel
      ? `This will stop Naviyra services, remove nginx/systemd files the panel installed, delete the panel database, and remove ${dest}\n`
      : `This will remove leftover Naviyra systemd units and nginx config (install dir ${dest} is already gone or incomplete)\n`
  );
  const removePostgres =
    flags.yes
      ? true
      : await askYesNo(
          rl,
          "Also drop PostgreSQL databases created by the panel (names starting with n_)?",
          true
        );
  const removeSites =
    flags.yes
      ? false
      : await askYesNo(rl, `Also remove hosted websites (${wwwRoot})?`, false);
  const removeMail =
    flags.yes
      ? false
      : await askYesNo(rl, `Also remove mailboxes (${mailRoot})?`, false);
  const removeDns =
    flags.yes
      ? false
      : await askYesNo(rl, `Also remove DNS zone files (${bindZones})?`, false);

  console.log("");
  const typed = flags.yes
    ? "UNINSTALL"
    : (await rl.question("Type UNINSTALL to confirm: ")).trim();
  if (typed !== "UNINSTALL") {
    log("Cancelled.");
    return;
  }

  if (hasPanel && fs.existsSync(path.join(dest, "launcher", "stop.mjs"))) {
    run(process.execPath, [path.join(dest, "launcher", "stop.mjs")], {
      cwd: dest,
      ignoreExit: true,
    });
  }

  cleanupLinuxPanelArtifacts({ dest, env, removeSites });

  if (hasPanel) removePanelDatabase(dest, env);
  if (removePostgres) dropHostedPostgresDatabases();

  if (removeSites) removeHostedWebsites(wwwRoot, dest);
  if (removeMail) removeTree(mailRoot, "mailboxes");
  if (removeDns) {
    removeTree(bindZones, "DNS zone files");
    removeTree(bindNamed, "BIND zone snippets");
    if (fs.existsSync(bindInclude)) {
      fs.writeFileSync(bindInclude, "// naviyra zones removed\n");
      log(`Cleared ${bindInclude}`);
    }
    run("rndc", ["reload"], { ignoreExit: true });
  }

  if (hasPanel && fs.existsSync(dest)) {
    log(`Removing ${dest}…`);
    fs.rmSync(dest, { recursive: true, force: true });
  }

  const kept = [];
  if (!removePostgres) kept.push("PostgreSQL databases");
  if (!removeSites) kept.push("websites");
  if (!removeMail) kept.push("mail");
  if (!removeDns) kept.push("DNS");
  log(
    kept.length
      ? `Uninstall complete. Left in place: ${kept.join(", ")}. nginx, PostgreSQL, and BIND packages were not removed.`
      : "Uninstall complete. Panel, database, websites, mail, DNS zone files, and Naviyra nginx/systemd files were removed."
  );
}

function removeTree(dir, label) {
  if (!dir || !fs.existsSync(dir)) {
    log(`No ${label} at ${dir || "(unset)"}`);
    return;
  }
  const resolved = path.resolve(dir);
  const blocked = new Set(["/", "/var", "/etc", "/usr", "/bin", "/home", "/opt", "/root"]);
  if (blocked.has(resolved) || resolved === path.parse(resolved).root) {
    log(`Refusing to delete ${resolved}`);
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  log(`Removed ${label}: ${resolved}`);
}

function removeHostedWebsites(wwwRoot, dest) {
  const localSites = path.join(dest, "sites");
  if (fs.existsSync(localSites)) removeTree(localSites, "panel sites/");

  if (!wwwRoot || !fs.existsSync(wwwRoot)) {
    log(`No websites at ${wwwRoot}`);
    return;
  }
  const skip = new Set(["certbot", "html", "default", "naviyra-errors"]);
  for (const name of fs.readdirSync(wwwRoot)) {
    if (skip.has(name) || name.startsWith(".")) continue;
    removeTree(path.join(wwwRoot, name), `website ${name}`);
  }
}

async function main() {
  ensurePanelNode();
  const { command, flags } = parseArgs(process.argv);
  if (flags.help) {
    printHelp();
    return;
  }

  banner();
  const rl = createRl();
  try {
    let cmd = command;
    if (!cmd) {
      const existing = findExistingInstall({ dirFlag: flags.dir });
      console.log("  1) Install     — new server (asks domain, IP, .env values)");
      console.log("  2) Upgrade     — update files, keep .env and database");
      console.log("  3) Reconfigure .env");
      console.log("  4) Uninstall   — stop services, remove nginx/systemd leftovers, delete panel + database");
      console.log("  5) Status      — green/red check of panel, nginx, PostgreSQL, timers");
      console.log("  6) Help / quit\n");
      const choice = (await rl.question(existing ? `Choice [2] (found ${existing}): ` : "Choice [1]: ")).trim() || (existing ? "2" : "1");
      if (choice === "1" || choice.toLowerCase() === "install") cmd = "install";
      else if (choice === "2" || choice.toLowerCase() === "upgrade") cmd = "upgrade";
      else if (choice === "3" || choice.toLowerCase().startsWith("re")) cmd = "reconfigure";
      else if (choice === "4" || choice.toLowerCase().startsWith("un")) cmd = "uninstall";
      else if (choice === "5" || choice.toLowerCase().startsWith("st")) cmd = "status";
      else {
        printHelp();
        return;
      }
      if (!flags.dir && existing && cmd !== "install") flags.dir = existing;
    }

    if (cmd === "install") await cmdInstall(rl, flags);
    else if (cmd === "upgrade") await cmdUpgrade(rl, flags);
    else if (cmd === "reconfigure" || cmd === "configure" || cmd === "env") await cmdReconfigure(rl, flags);
    else if (cmd === "uninstall" || cmd === "remove") await cmdUninstall(rl, flags);
    else if (cmd === "status") {
      const dest =
        flags.dir ||
        findExistingInstall({ dirFlag: flags.dir }) ||
        defaultInstallDir();
      printLinuxInstallStatus(dest);
    }
    else if (cmd === "help") printHelp();
    else {
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exitCode = 1;
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`\n[naviyra] ${err.message || err}`);
  process.exit(1);
});
