import fs from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

export function getNodeBin(nodeBin = process.execPath) {
  return nodeBin;
}

function getNpmCli(nodeBin) {
  const npmCli = path.join(
    path.dirname(nodeBin),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js"
  );
  return fs.existsSync(npmCli) ? npmCli : null;
}

function getNpxCli(nodeBin) {
  const npxCli = path.join(
    path.dirname(nodeBin),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js"
  );
  return fs.existsSync(npxCli) ? npxCli : null;
}

/** Run npm without shell (avoids breaking node.exe paths with spaces on Windows). */
export function resolveNpmInvocation(npmArgs, nodeBin = process.execPath) {
  const npmCli = getNpmCli(nodeBin);
  if (npmCli) {
    return { cmd: nodeBin, args: [npmCli, ...npmArgs], shell: false };
  }
  if (isWindows) {
    return { cmd: "npm.cmd", args: npmArgs, shell: true };
  }
  return { cmd: "npm", args: npmArgs, shell: false };
}

/** Run npx without shell when npm-cli is bundled with Node. */
export function resolveNpxInvocation(npxArgs, nodeBin = process.execPath) {
  const npxCli = getNpxCli(nodeBin);
  if (npxCli) {
    return { cmd: nodeBin, args: [npxCli, ...npxArgs], shell: false };
  }
  if (isWindows) {
    return { cmd: "npx.cmd", args: npxArgs, shell: true };
  }
  return { cmd: "npx", args: npxArgs, shell: false };
}

/** Run a Node script (e.g. Prisma CLI) without shell. */
export function resolveNodeScript(scriptPath, scriptArgs = [], nodeBin = process.execPath) {
  return { cmd: nodeBin, args: [scriptPath, ...scriptArgs], shell: false };
}
