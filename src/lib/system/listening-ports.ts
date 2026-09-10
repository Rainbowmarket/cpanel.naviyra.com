import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ListeningPort = {
  proto: "tcp" | "udp";
  port: number;
  addresses: string[];
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

function isLoopback(addr: string): boolean {
  const a = addr.replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK.has(a);
}

function isWildcard(addr: string): boolean {
  const a = addr.replace(/^\[|\]$/g, "");
  return a === "0.0.0.0" || a === "::" || a === "*" || a === "";
}

/** Split "0.0.0.0:22" / "[::]:443" / "*:80" into address + port. */
export function parseLocalEndpoint(
  local: string
): { addr: string; port: number } | null {
  const trimmed = local.trim();
  if (!trimmed) return null;
  const bracket = trimmed.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracket) {
    const port = Number(bracket[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { addr: bracket[1], port };
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon < 0) return null;
  const addr = trimmed.slice(0, colon);
  const port = Number(trimmed.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { addr: addr || "*", port };
}

function fingerprint(proto: "tcp" | "udp", port: number): string {
  return `port:${proto}:${port}`;
}

export function portFingerprint(entry: ListeningPort): string {
  return fingerprint(entry.proto, entry.port);
}

function mergePort(
  map: Map<string, ListeningPort>,
  proto: "tcp" | "udp",
  port: number,
  addr: string
) {
  const key = fingerprint(proto, port);
  const existing = map.get(key);
  if (existing) {
    if (!existing.addresses.includes(addr)) existing.addresses.push(addr);
    return;
  }
  map.set(key, { proto, port, addresses: [addr] });
}

function parseSsLine(line: string): {
  proto: "tcp" | "udp";
  addr: string;
  port: number;
} | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const netid = parts[0]?.toLowerCase();
  if (netid !== "tcp" && netid !== "udp") return null;
  const state = parts[1]?.toUpperCase();
  if (netid === "tcp" && state !== "LISTEN") return null;
  const local = parts[4];
  const parsed = parseLocalEndpoint(local);
  if (!parsed) return null;
  return { proto: netid, addr: parsed.addr, port: parsed.port };
}

/**
 * Listening TCP/UDP ports bound to a non-loopback address (0.0.0.0, ::, or a
 * public IP). Localhost-only sockets (panel, postgres, app runtimes) are ignored.
 */
export async function collectPublicListeningPorts(): Promise<ListeningPort[]> {
  if (process.platform === "win32") return [];
  let stdout = "";
  try {
    const result = await execFileAsync("ss", ["-lntuH"], {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    try {
      const result = await execFileAsync("ss", ["-lntu"], {
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });
      stdout = result.stdout;
    } catch {
      return [];
    }
  }

  const map = new Map<string, ListeningPort>();
  for (const line of stdout.split(/\r?\n/)) {
    const parsed = parseSsLine(line);
    if (!parsed) continue;
    mergePort(map, parsed.proto, parsed.port, parsed.addr);
  }

  return [...map.values()]
    .filter((entry) =>
      entry.addresses.some((addr) => isWildcard(addr) || !isLoopback(addr))
    )
    .sort((a, b) => a.proto.localeCompare(b.proto) || a.port - b.port);
}
