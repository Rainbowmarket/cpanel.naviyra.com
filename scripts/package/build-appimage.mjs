/**
 * Build AppImage (Linux only)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { createWriteStream } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BUNDLE = path.join(ROOT, "dist", "bundle");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;
const ARCH = process.arch === "arm64" ? "aarch64" : "x86_64";

function log(msg) {
  console.log(`[package:appimage] ${msg}`);
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
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function ensureAppImageTool() {
  const tool = path.join(ROOT, "dist", "cache", "appimagetool-x86_64.AppImage");
  if (!fs.existsSync(tool)) {
    log("Downloading appimagetool...");
    await downloadFile(
      "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage",
      tool
    );
    fs.chmodSync(tool, 0o755);
  }
  return tool;
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error("Build AppImage on Linux");
  }
  if (!fs.existsSync(BUNDLE)) {
    throw new Error("Bundle missing. Run: npm run package:prepare");
  }
  if (!fs.existsSync(path.join(BUNDLE, "node"))) {
    throw new Error("Embedded Node required. Run: npm run package:prepare -- --embed-node");
  }

  const appDir = path.join(ROOT, "dist", "appimage", "NaviyraPanel.AppDir");
  fs.rmSync(path.join(ROOT, "dist", "appimage"), { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  copyDir(path.join(BUNDLE, "app"), path.join(appDir, "opt", "naviyra", "app"));
  copyDir(path.join(BUNDLE, "node"), path.join(appDir, "opt", "node"));
  copyDir(path.join(BUNDLE, "bin"), path.join(appDir, "opt", "naviyra", "bin"));

  const tpl = path.join(__dirname, "templates", "appimage");
  fs.copyFileSync(path.join(tpl, "AppRun"), path.join(appDir, "AppRun"));
  fs.chmodSync(path.join(appDir, "AppRun"), 0o755);
  fs.chmodSync(path.join(appDir, "opt", "naviyra", "bin", "naviyra-panel"), 0o755);

  fs.mkdirSync(path.join(appDir, "usr", "share", "applications"), { recursive: true });
  fs.copyFileSync(
    path.join(tpl, "naviyra-panel.desktop"),
    path.join(appDir, "usr", "share", "applications", "naviyra-panel.desktop")
  );

  const iconDir = path.join(appDir, "usr", "share", "icons", "hicolor", "256x256", "apps");
  fs.mkdirSync(iconDir, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "public", "window.svg"),
    path.join(iconDir, "naviyra-panel.svg")
  );
  fs.copyFileSync(path.join(iconDir, "naviyra-panel.svg"), path.join(appDir, "naviyra-panel.svg"));

  const output = path.join(ROOT, "dist", `NaviyraPanel-${VERSION}-${ARCH}.AppImage`);
  const tool = await ensureAppImageTool();

  log("Building AppImage (may require libfuse2 on older systems)...");
  const result = spawnSync(tool, [appDir, output], {
    stdio: "inherit",
    env: { ...process.env, ARCH, VERSION },
  });

  if (result.status !== 0) {
    throw new Error("appimagetool failed");
  }

  fs.chmodSync(output, 0o755);
  log(`Created: ${output}`);
  log(`Run: chmod +x ${path.basename(output)} && ./${path.basename(output)}`);
}

main().catch((err) => {
  console.error("[package:appimage]", err.message);
  process.exit(1);
});
