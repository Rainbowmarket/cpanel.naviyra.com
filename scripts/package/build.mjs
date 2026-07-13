/**
 * Full packaging pipeline
 *
 * Usage:
 *   node scripts/package/build.mjs              # platform default
 *   node scripts/package/build.mjs --target win
 *   node scripts/package/build.mjs --target deb
 *   node scripts/package/build.mjs --target appimage
 *   node scripts/package/build.mjs --target all  # linux: deb + appimage
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const target =
  targetIdx >= 0 ? args[targetIdx + 1] : process.platform === "win32" ? "win" : "linux";

function run(script, extraArgs = []) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...extraArgs], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("[package] Step 1/3 — prepare release + embed Node");
run("prepare-release.mjs", ["--embed-node"]);

console.log("[package] Step 2/3 — finalize bundle");
run("finalize-bundle.mjs");

console.log("[package] Step 3/3 — build installers");

if (target === "win") {
  if (process.platform !== "win32") {
    console.warn("[package] Windows .exe should be built on Windows with Inno Setup.");
  } else {
    run("build-windows.mjs");
  }
} else if (target === "deb") {
  run("build-deb.mjs");
} else if (target === "appimage") {
  run("build-appimage.mjs");
} else if (target === "all" || target === "linux") {
  if (process.platform !== "linux") {
    console.warn("[package] .deb and AppImage require Linux.");
  } else {
    run("build-deb.mjs");
    run("build-appimage.mjs");
  }
} else if (process.platform === "win32") {
  run("build-windows.mjs");
} else if (process.platform === "linux") {
  run("build-deb.mjs");
  run("build-appimage.mjs");
}

console.log("[package] Done. See dist/ folder.");
