import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DiskVolume = {
  mount: string;
  filesystem: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
};

export type DiskPathUsage = {
  id: string;
  label: string;
  path: string;
  bytes: number | null;
  missing?: boolean;
};

export type DiskReport = {
  volumes: DiskVolume[];
  paths: DiskPathUsage[];
  collectedAt: string;
};

export function formatDiskBytes(n: number | null | undefined): string {
  if (n == null || n < 0 || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirSizeBytes(target: string): Promise<number | null> {
  if (!(await pathExists(target))) return null;

  if (process.platform !== "win32") {
    try {
      const { stdout } = await execFileAsync("du", ["-sb", target], {
        timeout: 8_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const first = stdout.trim().split(/\s+/)[0];
      const n = Number(first);
      return Number.isFinite(n) ? n : null;
    } catch {
      // fall through to walk
    }
  }

  return walkDirSize(target, 8_000);
}

async function walkDirSize(root: string, maxEntries: number): Promise<number | null> {
  let total = 0;
  let seen = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) return total;
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          const st = await fs.stat(full);
          total += st.size;
        }
      } catch {
        // skip unreadable
      }
    }
  }
  return total;
}

async function volumeFromStatfs(mount: string): Promise<DiskVolume | null> {
  try {
    // Node 18.15+
    const stats = await (
      fs as typeof fs & {
        statfs: (path: string) => Promise<{
          bsize: number;
          blocks: number;
          bfree: number;
          bavail: number;
        }>;
      }
    ).statfs(mount);
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      mount,
      filesystem: mount,
      totalBytes,
      usedBytes,
      availableBytes,
    };
  } catch {
    return null;
  }
}

async function volumesFromDf(): Promise<DiskVolume[]> {
  if (process.platform === "win32") return [];
  try {
    const { stdout } = await execFileAsync("df", ["-B1", "-P"], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    const lines = stdout.trim().split("\n").slice(1);
    const wanted = new Set(["/", "/var", "/home", "/opt"]);
    const out: DiskVolume[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [filesystem, total, used, available, , ...mountParts] = parts;
      const mount = mountParts.join(" ");
      if (!wanted.has(mount) && mount !== "/") continue;
      out.push({
        mount,
        filesystem,
        totalBytes: Number(total) || 0,
        usedBytes: Number(used) || 0,
        availableBytes: Number(available) || 0,
      });
    }
    // Prefer unique mounts; ensure / is first
    const byMount = new Map(out.map((v) => [v.mount, v]));
    const ordered: DiskVolume[] = [];
    for (const m of ["/", "/var", "/opt", "/home"]) {
      const v = byMount.get(m);
      if (v) ordered.push(v);
    }
    return ordered.length > 0 ? ordered : out.slice(0, 3);
  } catch {
    return [];
  }
}

export type DiskReportInput = {
  backupRoot?: string | null;
  websiteRoots?: Array<{ id: string; label: string; path: string }>;
};

export async function collectDiskReport(
  input: DiskReportInput = {}
): Promise<DiskReport> {
  let volumes = await volumesFromDf();
  if (volumes.length === 0) {
    const mount = process.platform === "win32" ? process.cwd().slice(0, 3) || "C:\\" : "/";
    const v = await volumeFromStatfs(mount);
    if (v) volumes = [v];
  }

  const panelRoot = process.cwd();
  const websitesRoot =
    process.platform === "win32"
      ? path.join(panelRoot, "sites")
      : "/var/www";
  const mailRoot = path.join(panelRoot, "data", "mail");
  const panelDataRoot = path.join(panelRoot, "data");
  const backupRoot =
    input.backupRoot?.trim() ||
    (process.platform === "win32"
      ? path.join(panelRoot, "data", "backups")
      : "/var/backups/naviyra");

  const domainRoots = (input.websiteRoots ?? []).slice(0, 12);
  const domainSized = await Promise.all(
    domainRoots.map(async (d) => {
      const exists = await pathExists(d.path);
      if (!exists) {
        return {
          id: `domain:${d.id}`,
          label: d.label,
          path: d.path,
          bytes: null,
          missing: true,
        } satisfies DiskPathUsage;
      }
      return {
        id: `domain:${d.id}`,
        label: d.label,
        path: d.path,
        bytes: await dirSizeBytes(d.path),
        missing: false,
      } satisfies DiskPathUsage;
    })
  );
  domainSized.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));

  const websitesFromDomains = domainSized.reduce(
    (sum, d) => sum + (d.bytes ?? 0),
    0
  );

  const [mailBytes, backupBytes, panelBytes, websitesFallback] =
    await Promise.all([
      pathExists(mailRoot).then(async (ok) =>
        ok ? dirSizeBytes(mailRoot) : null
      ),
      pathExists(backupRoot).then(async (ok) =>
        ok ? dirSizeBytes(backupRoot) : null
      ),
      pathExists(panelDataRoot).then(async (ok) =>
        ok ? dirSizeBytes(panelDataRoot) : null
      ),
      domainRoots.length > 0
        ? Promise.resolve(null)
        : pathExists(websitesRoot).then(async (ok) =>
            ok ? dirSizeBytes(websitesRoot) : null
          ),
    ]);

  const websitesExists = await pathExists(websitesRoot);
  const sized: DiskPathUsage[] = [
    {
      id: "websites",
      label: "Websites",
      path: websitesRoot,
      bytes:
        domainRoots.length > 0
          ? websitesFromDomains
          : websitesFallback,
      missing: domainRoots.length > 0 ? false : !websitesExists,
    },
    {
      id: "mail",
      label: "Mail",
      path: mailRoot,
      bytes: mailBytes,
      missing: mailBytes == null && !(await pathExists(mailRoot)),
    },
    {
      id: "backups",
      label: "Backups",
      path: backupRoot,
      bytes: backupBytes,
      missing: backupBytes == null && !(await pathExists(backupRoot)),
    },
    {
      id: "panel",
      label: "Panel data",
      path: panelDataRoot,
      bytes: panelBytes,
      missing: panelBytes == null && !(await pathExists(panelDataRoot)),
    },
  ];

  return {
    volumes,
    paths: [...sized, ...domainSized],
    collectedAt: new Date().toISOString(),
  };
}
