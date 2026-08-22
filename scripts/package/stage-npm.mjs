/**
 * Stage a thin npm package for npmjs.com.
 *
 * Layout:
 *   dist/npm/package.json          official: @naviyra/hosting-panel (root package.json name)
 *                                  test:     naviyra-hosting-pannel (--test)
 *   dist/npm/npx.mjs + env-fields + install-utils
 *   dist/npm/panel/                full panel source (npm install happens on the server)
 *
 * Usage:
 *   npm run npm:pack
 *   npm run npm:publish            official scoped package
 *   npm run npm:publish:test       unscoped test package (bump version; 0.0.1 is taken)
 */

const TEST_PACKAGE_NAME = "naviyra-hosting-pannel";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "dist", "npm");
const CLI = path.join(ROOT, "cli");

const SKIP_DIRS = new Set([
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

const SKIP_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "commit_to_npx.txt",
  ".npmrc",
  ".npm-token",
]);

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function writeTextFile(destPath, srcPath) {
  const ext = path.extname(destPath).toLowerCase();
  const unix = new Set([".sh", ".bash", ".service", ".timer", ".conf", ".mjs"]);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (!unix.has(ext)) {
    fs.copyFileSync(srcPath, destPath);
    return;
  }
  const text = fs.readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  fs.writeFileSync(destPath, text);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else if (entry.isFile()) writeTextFile(destPath, srcPath);
  }
}

function publishNameFromArgs() {
  if (process.argv.includes("--test")) return TEST_PACKAGE_NAME;
  const i = process.argv.indexOf("--name");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return rootPkg.name || TEST_PACKAGE_NAME;
}

function binNames(pkgName) {
  const bins = {};
  const short = pkgName.includes("/") ? pkgName.split("/").pop() : pkgName;
  bins[short] = "npx.mjs";
  bins[pkgName.replace(/^@/, "").replace("/", "-")] = "npx.mjs";
  if (pkgName !== TEST_PACKAGE_NAME) bins[TEST_PACKAGE_NAME] = "npx.mjs";
  return bins;
}

function main() {
  const publishName = publishNameFromArgs();
  const npxCmd = `npx ${publishName}`;
  if (process.argv.includes("--test") && rootPkg.version === "0.0.1") {
    console.warn(
      `[npm-pack] ${TEST_PACKAGE_NAME}@0.0.1 is already on npm. Bump "version" in package.json before npm:publish:test.`
    );
  }
  console.log(`[npm-pack] Staging ${publishName}@${rootPkg.version} → ${OUT}`);
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  for (const file of ["npx.mjs", "env-fields.mjs", "install-utils.mjs"]) {
    writeTextFile(path.join(OUT, file), path.join(CLI, file));
  }

  copyDir(ROOT, path.join(OUT, "panel"));
  fs.rmSync(path.join(OUT, "panel", "cli", "panel"), { recursive: true, force: true });

  const pkg = {
    name: publishName,
    version: rootPkg.version,
    description: `Naviyra Hosting Panel installer — ${npxCmd} (prompts for domain, server IP, .env; supports upgrade).`,
    bin: binNames(publishName),
    type: "module",
    engines: { node: ">=20" },
    files: ["npx.mjs", "env-fields.mjs", "install-utils.mjs", "panel", "LICENSE"],
    keywords: ["naviyra", "hosting", "cpanel", "panel", "npx"],
    license: "MIT",
    publishConfig: { access: "public" },
  };
  fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(OUT, "LICENSE"));

  const readme = `# ${publishName}

Naviyra Hosting Panel — install and upgrade from npm.

## Install

\`\`\`bash
${npxCmd}
# or
${npxCmd} install --dir /opt/naviyra-panel
\`\`\`

The wizard asks for the same values as \`.env\` (domain, public IP, nameservers, mail, ports) and shows examples.

Requires **Node.js 20+**. On Linux the installer prefers nvm latest LTS (installs it if missing) so systemd matches native modules. Run with \`sudo\` to install under \`/opt/naviyra-panel\` and optionally systemd. PostgreSQL is installed for customer databases if it is not already present.

## Upgrade

Keeps \`.env\` and \`data/\` (database, uploads).

\`\`\`bash
${npxCmd} upgrade --dir /opt/naviyra-panel
\`\`\`

## Reconfigure

\`\`\`bash
${npxCmd} reconfigure --dir /opt/naviyra-panel
\`\`\`

## Uninstall

Deletes the panel database so a reinstall shows first-time admin setup. Also removes Naviyra systemd units and nginx files (visitor log, websocket map, snippets, panel vhost). Panel-created PostgreSQL databases are dropped by default. Hosted websites, mail, and DNS are kept unless you confirm. nginx/PostgreSQL/BIND packages are not removed.

\`\`\`bash
${npxCmd} uninstall --dir /opt/naviyra-panel
\`\`\`

## License

MIT — see [LICENSE](./LICENSE).
`;
  fs.writeFileSync(path.join(OUT, "README.md"), readme);

  console.log("[npm-pack] Ready. Publish with:");
  console.log("  npm publish ./dist/npm --access public");
}

main();
