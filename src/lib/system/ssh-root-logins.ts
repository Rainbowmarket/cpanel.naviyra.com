import fs from "node:fs/promises";

export type SshRootLogin = {
  at: Date;
  method: string;
  ip: string;
  port: string;
  raw: string;
};

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const ISO_RE =
  /^(\d{4}-\d{2}-\d{2}T\S+)\s+\S+\s+sshd\[\d+\]:\s+Accepted (password|publickey|keyboard-interactive(?:\/\S+)?) for root from (\S+) port (\d+)/;

const SYSLOG_RE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+sshd\[\d+\]:\s+Accepted (password|publickey|keyboard-interactive(?:\/\S+)?) for root from (\S+) port (\d+)/;

function parseSyslogDate(month: string, day: string, time: string): Date | null {
  const monthIdx = MONTHS[month];
  if (monthIdx == null) return null;
  const [hh, mm, ss] = time.split(":").map(Number);
  const now = new Date();
  const year = now.getFullYear();
  const at = new Date(year, monthIdx, Number(day), hh, mm, ss);
  if (Number.isNaN(at.getTime())) return null;
  // Syslog has no year; if the stamp is more than a day in the future, it was last year.
  if (at.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
    at.setFullYear(year - 1);
  }
  return at;
}

export function parseSshRootLoginLine(line: string): SshRootLogin | null {
  const iso = line.match(ISO_RE);
  if (iso) {
    const at = new Date(iso[1]);
    if (Number.isNaN(at.getTime())) return null;
    return {
      at,
      method: iso[2],
      ip: iso[3],
      port: iso[4],
      raw: line.trim(),
    };
  }
  const syslog = line.match(SYSLOG_RE);
  if (!syslog) return null;
  const at = parseSyslogDate(syslog[1], syslog[2], syslog[3]);
  if (!at) return null;
  return {
    at,
    method: syslog[4],
    ip: syslog[5],
    port: syslog[6],
    raw: line.trim(),
  };
}

async function readLog(path: string): Promise<string> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return "";
  }
}

const AUTH_LOGS = ["/var/log/auth.log", "/var/log/auth.log.1", "/var/log/secure"];

export async function collectSshRootLoginsSince(
  since: Date
): Promise<SshRootLogin[]> {
  if (process.platform === "win32") return [];
  const chunks = await Promise.all(AUTH_LOGS.map((path) => readLog(path)));
  const found: SshRootLogin[] = [];
  const seen = new Set<string>();
  for (const text of chunks) {
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const login = parseSshRootLoginLine(line);
      if (!login) continue;
      if (login.at.getTime() <= since.getTime()) continue;
      const key = `${login.at.toISOString()}|${login.ip}|${login.port}|${login.method}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(login);
    }
  }
  found.sort((a, b) => a.at.getTime() - b.at.getTime());
  return found;
}
