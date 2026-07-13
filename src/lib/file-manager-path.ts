import path from "node:path";

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isPathUnderRoot(filePath: string, documentRoot: string): boolean {
  const target = normalizePath(filePath);
  const root = normalizePath(documentRoot);
  return target === root || target.startsWith(`${root}/`);
}

export function resolvePathWithinRoot(dirPath: string, documentRoot: string): string {
  const root = path.resolve(documentRoot);
  if (!dirPath) return root;
  const resolved = path.resolve(dirPath);
  if (isPathUnderRoot(resolved, root)) return resolved;
  return root;
}
