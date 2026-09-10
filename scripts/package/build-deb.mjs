/**
 * Build .deb package (Linux only)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyDir } from "./copy-dir.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BUNDLE = path.join(ROOT, "dist", "bundle");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;
const ARCH = process.arch === "arm64" ? "arm64" : "amd64";
const PKG = `naviyra-panel_${VERSION}_${ARCH}`;

function log(msg) {
  console.log(`[package:deb] ${msg}`);
}

function main() {
  if (process.platform !== "linux") {
    throw new Error("Build .deb on Linux");
  }
  if (!fs.existsSync(BUNDLE)) {
    throw new Error("Bundle missing. Run: npm run package:prepare");
  }

  const staging = path.join(ROOT, "dist", "deb", PKG);
  fs.rmSync(path.join(ROOT, "dist", "deb"), { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  copyDir(BUNDLE, path.join(staging, "opt", "naviyra-panel"));

  fs.mkdirSync(path.join(staging, "DEBIAN"), { recursive: true });
  fs.writeFileSync(
    path.join(staging, "DEBIAN", "control"),
    `Package: naviyra-panel
Version: ${VERSION}
Section: web
Priority: optional
Architecture: ${ARCH}
Depends: ca-certificates
Maintainer: Naviyra <support@naviyra.com>
Description: Naviyra self-hosted hosting control panel
 Web UI for domains, mail, FTP, SSL, DNS, and files.
Homepage: https://naviyra.com
`,
    "utf8"
  );

  const tpl = path.join(__dirname, "templates", "linux");
  fs.copyFileSync(path.join(tpl, "deb-postinst"), path.join(staging, "DEBIAN", "postinst"));
  fs.copyFileSync(path.join(tpl, "deb-prerm"), path.join(staging, "DEBIAN", "prerm"));
  fs.chmodSync(path.join(staging, "DEBIAN", "postinst"), 0o755);
  fs.chmodSync(path.join(staging, "DEBIAN", "prerm"), 0o755);

  fs.mkdirSync(path.join(staging, "etc", "systemd", "system"), { recursive: true });
  fs.copyFileSync(
    path.join(tpl, "naviyra-panel.service"),
    path.join(staging, "etc", "systemd", "system", "naviyra-panel.service")
  );

  fs.mkdirSync(path.join(staging, "usr", "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(staging, "usr", "bin", "naviyra-panel"),
    `#!/bin/bash
exec /opt/naviyra-panel/bin/naviyra-panel "$@"
`,
    "utf8"
  );
  fs.chmodSync(path.join(staging, "usr", "bin", "naviyra-panel"), 0o755);
  fs.chmodSync(path.join(staging, "opt", "naviyra-panel", "bin", "naviyra-panel"), 0o755);

  const debPath = path.join(ROOT, "dist", `${PKG}.deb`);
  if (fs.existsSync(debPath)) fs.unlinkSync(debPath);

  log("Running dpkg-deb...");
  const result = spawnSync("dpkg-deb", ["--build", staging, debPath], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("dpkg-deb failed. Install: sudo apt install dpkg");
  }

  log(`Created: ${debPath}`);
  log("Install: sudo dpkg -i dist/" + `${PKG}.deb`);
  log("Start:   sudo systemctl enable --now naviyra-panel");
}

main();
