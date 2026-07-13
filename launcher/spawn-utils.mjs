import fs from "node:fs";
import path from "node:path";

export function needsShell(cmd) {
  if (process.platform !== "win32") return false;
  return /\.(cmd|bat)$/i.test(cmd);
}

export function resolveNodeExecutable(nodePath) {
  return nodePath ?? process.execPath;
}

export function resolveNpmCommand(npmArgs, opts = {}) {
  const node = resolveNodeExecutable(opts.node);
  if (process.platform === "win32") {
    const npmCli = path.join(
      path.dirname(node),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    );
    if (fs.existsSync(npmCli)) {
      return { cmd: node, args: [npmCli, ...npmArgs], shell: false };
    }
    return { cmd: "npm.cmd", args: npmArgs, shell: true };
  }
  return { cmd: "npm", args: npmArgs, shell: false };
}

export function resolveNpxCommand(npxArgs, opts = {}) {
  const node = resolveNodeExecutable(opts.node);
  if (process.platform === "win32") {
    const npxCli = path.join(
      path.dirname(node),
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js"
    );
    if (fs.existsSync(npxCli)) {
      return { cmd: node, args: [npxCli, ...npxArgs], shell: false };
    }
    return { cmd: "npx.cmd", args: npxArgs, shell: true };
  }
  return { cmd: "npx", args: npxArgs, shell: false };
}
