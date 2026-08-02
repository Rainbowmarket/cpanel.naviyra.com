/**
 * Create a deployable source zip under Output/zip.
 * Excludes build artifacts, secrets, and node_modules.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "Output", "zip");

const EXCLUDES = [
  "node_modules",
  "agent/node_modules",
  "security-manager/frontend/node_modules",
  ".next",
  "out",
  "dist",
  "data",
  "sites",
  ".git",
  ".env",
  ".env.local",
  "Output",
  "*.db",
  "*.db-journal",
  ".DS_Store",
];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = pkg.version || "0.0.0";
  const zipName = `naviyra-panel-${version}-${stamp()}.zip`;
  const zipPath = path.join(OUT_DIR, zipName);

  for (const old of fs.readdirSync(OUT_DIR)) {
    if (old.startsWith("naviyra-panel-") && old.endsWith(".zip")) {
      // keep previous zips; only remove identical name if any
      if (old === zipName) fs.unlinkSync(path.join(OUT_DIR, old));
    }
  }

  const excludeArgs = EXCLUDES.flatMap((pattern) => ["--exclude", pattern]);
  // Windows tar (bsdtar) / GNU tar: -a selects format from .zip extension
  const args = ["-a", "-cf", zipPath, ...excludeArgs, "-C", ROOT, "."];

  console.log(`Creating ${zipPath}`);
  const result = spawnSync("tar", args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });

  if (result.error || result.status !== 0) {
    console.error("tar failed — is tar available on PATH?");
    process.exit(result.status || 1);
  }

  const sizeMb = (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2);
  console.log(`OK ${zipName} (${sizeMb} MB)`);
  console.log(`Output: ${zipPath}`);
}

main();
