/**
 * Wrap dist/release into dist/bundle/ { app, node, bin }
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const RELEASE = path.join(ROOT, "dist", "release");
const BUNDLE = path.join(ROOT, "dist", "bundle");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  if (!fs.existsSync(RELEASE)) {
    throw new Error("Run prepare-release first (dist/release missing)");
  }

  rmrf(BUNDLE);
  fs.mkdirSync(BUNDLE, { recursive: true });

  copyDir(RELEASE, path.join(BUNDLE, "app"));

  const nodeInDist = path.join(ROOT, "dist", "node");
  if (fs.existsSync(nodeInDist)) {
    copyDir(nodeInDist, path.join(BUNDLE, "node"));
  }

  const binTpl = path.join(__dirname, "templates", "bin");
  copyDir(binTpl, path.join(BUNDLE, "bin"));

  if (process.platform !== "win32") {
    fs.chmodSync(path.join(BUNDLE, "bin", "naviyra-panel"), 0o755);
  }

  fs.writeFileSync(path.join(BUNDLE, "VERSION"), `${VERSION}\n`);
  console.log(`[package] Bundle ready: ${BUNDLE}`);
}

main();
