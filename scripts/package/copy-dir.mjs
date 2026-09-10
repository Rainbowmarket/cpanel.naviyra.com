import fs from "node:fs";
import path from "node:path";

/**
 * Copy a directory tree. Follows Windows junctions / symlinks (npm `file:`
 * deps such as zeptomatch) instead of copyFileSync on the reparse point.
 */
export function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    let st;
    try {
      st = fs.statSync(s);
    } catch {
      continue;
    }
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
