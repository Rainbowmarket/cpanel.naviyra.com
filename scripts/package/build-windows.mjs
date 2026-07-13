/**
 * Build Windows .exe installer (Inno Setup) + portable zip
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BUNDLE = path.join(ROOT, "dist", "bundle");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;

function log(msg) {
  console.log(`[package:win] ${msg}`);
}

function findIscc() {
  const candidates = [
    process.env.ISCC,
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const which = spawnSync("where", ["iscc"], { encoding: "utf8", shell: true });
  if (which.status === 0) {
    return which.stdout.trim().split("\n")[0];
  }
  return null;
}

function createZipPortable() {
  const zipPath = path.join(ROOT, "dist", `NaviyraPanel-${VERSION}-win-x64.zip`);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const ps = `
    Compress-Archive -Path '${BUNDLE}\\*' -DestinationPath '${zipPath}' -Force
  `;
  spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  log(`Portable zip: ${zipPath}`);
}

function main() {
  if (!fs.existsSync(BUNDLE)) {
    throw new Error("Bundle missing. Run: npm run package:prepare");
  }

  const iss = path.join(__dirname, "templates", "windows", "installer.iss");
  let issContent = fs.readFileSync(iss, "utf8");
  issContent = issContent.replace(/#define AppVersion ".*"/, `#define AppVersion "${VERSION}"`);
  const issBuild = path.join(ROOT, "dist", "installer.iss");
  fs.writeFileSync(issBuild, issContent);

  const iscc = findIscc();
  if (iscc) {
    log(`Building installer with ${iscc}`);
    const result = spawnSync(iscc, ["installer.iss"], {
      stdio: "inherit",
      cwd: path.join(ROOT, "dist"),
    });
    if (result.status === 0) {
      log(`Installer: dist/NaviyraPanel-Setup-${VERSION}.exe`);
    } else {
      throw new Error("Inno Setup compilation failed");
    }
  } else {
    log("Inno Setup 6 not found — creating portable zip only.");
    log("Install Inno Setup from https://jrsoftware.org/isinfo.php for .exe installer.");
    createZipPortable();
    return;
  }

  createZipPortable();
}

main();
