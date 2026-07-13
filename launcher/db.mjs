import fs from "node:fs";
import path from "node:path";

export function isPackagedApp(root) {
  return fs.existsSync(path.join(root, ".naviyra-packaged"));
}

export function isPrismaClientReady(root) {
  return fs.existsSync(path.join(root, "src", "generated", "prisma", "client.ts"));
}

export function getDatabaseFile(root) {
  return path.join(root, "data", "naviyra.db");
}

export function isDatabaseInitialized(root) {
  return fs.existsSync(getDatabaseFile(root));
}

export function getPrismaCli(root) {
  const candidates = [
    path.join(root, "node_modules", "prisma", "build", "index.js"),
    path.join(root, "node_modules", "prisma", "build", "child.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

export function getTsxCli(root) {
  const candidates = [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "node_modules", "tsx", "dist", "cli.cjs"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}
