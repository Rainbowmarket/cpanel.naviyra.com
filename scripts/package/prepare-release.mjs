/**
 * Prepare a production release bundle under dist/release/
 *
 * Usage: node scripts/package/prepare-release.mjs [--embed-node]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { createWriteStream } from "node:fs";
import { needsShell, resolveNpmCommand } from "../../launcher/spawn-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;
const NODE_VERSION = "20.18.1";
const OUT = path.join(ROOT, "dist", "release");
const NODE_OUT = path.join(ROOT, "dist", "node");
const embedNode = process.argv.includes("--embed-node");

function log(msg) {
  console.log(`[package] ${msg}`);
}

function run(cmd, args, opts = {}) {
  log(`> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: "inherit",
    shell: opts.shell ?? needsShell(cmd),
    env: { ...process.env, ...opts.env },
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function runNpm(args, opts = {}) {
  const resolved = resolveNpmCommand(args, opts);
  run(resolved.cmd, resolved.args, { ...opts, shell: resolved.shell });
}

function copyDir(src, dest, filter) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filter && !filter(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmrf(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "data",
  ".cursor",
  "terminals",
]);

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

async function downloadFile(url, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          downloadFile(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed ${url}: ${res.statusCode}`));
          return;
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function embedNodeRuntime(platform, arch) {
  const nodeDir = NODE_OUT;
  rmrf(nodeDir);
  fs.mkdirSync(nodeDir, { recursive: true });

  const cacheDir = path.join(ROOT, "dist", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  if (platform === "win32") {
    const zipName = `node-v${NODE_VERSION}-win-${arch === "arm64" ? "arm64" : "x64"}.zip`;
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;
    const zipPath = path.join(cacheDir, zipName);
    if (!fs.existsSync(zipPath)) {
      log(`Downloading ${url}`);
      await downloadFile(url, zipPath);
    }
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${cacheDir}' -Force`,
    ]);
    const extracted = path.join(cacheDir, `node-v${NODE_VERSION}-win-${arch === "arm64" ? "arm64" : "x64"}`);
    copyDir(extracted, nodeDir);
    return path.join(nodeDir, "node.exe");
  }

  const tarName = `node-v${NODE_VERSION}-linux-${arch === "arm64" ? "arm64" : "x64"}.tar.xz`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${tarName}`;
  const tarPath = path.join(cacheDir, tarName);
  if (!fs.existsSync(tarPath)) {
    log(`Downloading ${url}`);
    await downloadFile(url, tarPath);
  }
  const extractDir = path.join(cacheDir, `extract-${tarName}`);
  rmrf(extractDir);
  fs.mkdirSync(extractDir, { recursive: true });
  if (process.platform === "win32") {
    run("tar", ["-xJf", tarPath, "-C", extractDir, "--strip-components=1"]);
  } else {
    run("tar", ["-xJf", tarPath, "-C", extractDir, "--strip-components=1"]);
  }
  copyDir(extractDir, nodeDir);
  return path.join(nodeDir, "bin", "node");
}

async function main() {
  log(`Preparing Naviyra Panel v${VERSION} release...`);

  runNpm(["run", "build"]);

  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  const copyList = [
    ".next",
    "public",
    "src",
    "agent",
    "launcher",
    "prisma",
    "scripts",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "prisma.config.ts",
    "tsconfig.json",
    "postcss.config.mjs",
    ".env.example",
  ];

  for (const item of copyList) {
    const src = path.join(ROOT, item);
    const dest = path.join(OUT, item);
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, dest, (_p, entry) => {
        if (entry.isDirectory() && shouldSkipDir(entry.name)) return false;
        if (entry.name === "node_modules") return false;
        return true;
      });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  fs.writeFileSync(path.join(OUT, "VERSION"), `${VERSION}\n`, "utf8");

  log("Installing production dependencies...");
  runNpm(["ci", "--omit=dev"], { cwd: OUT });
  runNpm(["install", "prisma", "tsx", "dotenv", "--save-prod", "--no-save"], {
    cwd: OUT,
  });
  runNpm(["install", "tsx", "--save-prod", "--no-save"], {
    cwd: path.join(OUT, "agent"),
  });

  const prismaCli = path.join(OUT, "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(prismaCli)) {
    throw new Error("Prisma CLI missing from release bundle");
  }
  run(process.execPath, [prismaCli, "generate"], { cwd: OUT });

  fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
  fs.writeFileSync(path.join(OUT, ".naviyra-packaged"), "1\n", "utf8");

  if (embedNode) {
    const arch = process.arch;
    const platform = process.platform;
    if (platform !== "win32" && platform !== "linux") {
      log("Embedded Node skipped on this platform (use system Node)");
    } else {
      const nodePath = await embedNodeRuntime(platform, arch);
      log(`Embedded Node at ${nodePath}`);
    }
  }

  log(`Release ready: ${OUT}`);
}

main().catch((err) => {
  console.error("[package] Failed:", err.message);
  process.exit(1);
});
