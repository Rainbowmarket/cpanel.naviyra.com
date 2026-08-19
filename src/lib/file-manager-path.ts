/** POSIX-style path helpers that work in both Node and the browser (no `node:path`). */

function normalizePath(value: string): string {
  const unified = String(value || "").replace(/\\/g, "/");
  const drive = unified.match(/^([A-Za-z]:)/);
  const rest = drive ? unified.slice(drive[1].length) : unified;
  const isAbs = rest.startsWith("/");
  const parts: string[] = [];
  for (const seg of rest.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const body = parts.join("/");
  if (drive) return `${drive[1]}/${body}`.replace(/\/+$/, "");
  if (isAbs) return (`/${body}`).replace(/\/+$/, "") || "/";
  return body.replace(/\/+$/, "");
}

export function isPathUnderRoot(filePath: string, documentRoot: string): boolean {
  const target = normalizePath(filePath);
  const root = normalizePath(documentRoot);
  return target === root || target.startsWith(`${root}/`);
}

export function resolvePathWithinRoot(dirPath: string, documentRoot: string): string {
  const root = normalizePath(documentRoot);
  if (!dirPath) return root;
  const resolved = normalizePath(dirPath);
  if (isPathUnderRoot(resolved, root)) return resolved;
  return root;
}
