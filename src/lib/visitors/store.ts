import BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type SqliteDb = InstanceType<typeof BetterSqlite3>;

/** Keep visitor archives for this many calendar months (rolling). */
export const VISITOR_RETENTION_MONTHS = Math.max(
  1,
  Number(process.env.VISITOR_RETENTION_MONTHS ?? 6) || 6
);

export type VisitorLogRow = {
  id: string;
  domainId: string;
  domainName: string;
  userId: string;
  ipAddress: string;
  url: string;
  method: string;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  countryCode: string | null;
  countryName: string | null;
  referrer: string | null;
  statusCode: number | null;
  isBot: boolean;
  visitedAt: Date;
};

export type VisitorListRow = VisitorLogRow & {
  domain: { name: string };
};

const dbCache = new Map<string, SqliteDb>();
let lastPurgeAt = 0;

export function visitorDataDir(cwd = process.cwd()): string {
  const custom = process.env.VISITOR_DATA_DIR?.trim();
  return custom || path.join(cwd, "data", "visitors");
}

export function monthKeyFromDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function monthStartUtc(key: string): Date {
  const p = parseMonthKey(key)!;
  return new Date(Date.UTC(p.year, p.month - 1, 1));
}

function addMonthsUtc(d: Date, delta: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
}

export function retentionCutoffMonth(): string {
  return monthKeyFromDate(addMonthsUtc(new Date(), -VISITOR_RETENTION_MONTHS));
}

export function clampVisitorFromDate(from?: Date): Date | undefined {
  if (!from) return undefined;
  const min = monthStartUtc(retentionCutoffMonth());
  return from < min ? min : from;
}

export function listStoredMonthKeys(): string[] {
  const dir = visitorDataDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.db$/.test(f))
    .map((f) => f.replace(/\.db$/, ""))
    .sort();
}

/** Month keys from `from` through `to` (inclusive), capped at retention window. */
export function monthsInRange(from: Date, to: Date): string[] {
  const cutoff = retentionCutoffMonth();
  let start = monthKeyFromDate(from);
  if (start < cutoff) start = cutoff;
  const end = monthKeyFromDate(to);
  const keys: string[] = [];
  let cursor = monthStartUtc(start);
  const endTime = monthStartUtc(end).getTime();
  while (cursor.getTime() <= endTime) {
    const key = monthKeyFromDate(cursor);
    if (key >= cutoff) keys.push(key);
    cursor = addMonthsUtc(cursor, 1);
  }
  return keys.length ? keys : [monthKeyFromDate(new Date())];
}

function dbPathForMonth(key: string): string {
  return path.join(visitorDataDir(), `${key}.db`);
}

function ensureSchema(db: SqliteDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitor_logs (
      id TEXT PRIMARY KEY,
      domain_id TEXT NOT NULL,
      domain_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      user_agent TEXT,
      browser TEXT,
      os TEXT,
      country_code TEXT,
      country_name TEXT,
      referrer TEXT,
      status_code INTEGER,
      is_bot INTEGER NOT NULL DEFAULT 0,
      visited_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visitor_domain_time ON visitor_logs(domain_id, visited_at);
    CREATE INDEX IF NOT EXISTS idx_visitor_time ON visitor_logs(visited_at);
    CREATE INDEX IF NOT EXISTS idx_visitor_user ON visitor_logs(user_id, visited_at);
  `);
}

function openMonthDb(key: string): SqliteDb {
  const p = dbPathForMonth(key);
  let db = dbCache.get(p);
  if (!db) {
    fs.mkdirSync(visitorDataDir(), { recursive: true });
    db = new BetterSqlite3(p);
    ensureSchema(db);
    dbCache.set(p, db);
  }
  return db;
}

function rowFromDb(r: Record<string, unknown>): VisitorListRow {
  const visitedAt = new Date(Number(r.visited_at));
  const domainName = String(r.domain_name);
  return {
    id: String(r.id),
    domainId: String(r.domain_id),
    domainName,
    userId: String(r.user_id),
    ipAddress: String(r.ip_address),
    url: String(r.url),
    method: String(r.method ?? "GET"),
    userAgent: r.user_agent ? String(r.user_agent) : null,
    browser: r.browser ? String(r.browser) : null,
    os: r.os ? String(r.os) : null,
    countryCode: r.country_code ? String(r.country_code) : null,
    countryName: r.country_name ? String(r.country_name) : null,
    referrer: r.referrer ? String(r.referrer) : null,
    statusCode: r.status_code == null ? null : Number(r.status_code),
    isBot: Boolean(r.is_bot),
    visitedAt,
    domain: { name: domainName },
  };
}

type VisitorFilter = {
  userId?: string;
  admin?: boolean;
  domainId?: string;
  fromMs?: number;
  toMs?: number;
  search?: string;
};

function buildWhere(filter: VisitorFilter) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!filter.admin && filter.userId) {
    clauses.push("user_id = ?");
    params.push(filter.userId);
  }
  if (filter.domainId) {
    clauses.push("domain_id = ?");
    params.push(filter.domainId);
  }
  if (filter.fromMs != null) {
    clauses.push("visited_at >= ?");
    params.push(filter.fromMs);
  }
  if (filter.toMs != null) {
    clauses.push("visited_at <= ?");
    params.push(filter.toMs);
  }
  if (filter.search?.trim()) {
    const q = `%${filter.search.trim()}%`;
    clauses.push("(ip_address LIKE ? OR url LIKE ? OR browser LIKE ?)");
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

export function insertVisitorLog(row: Omit<VisitorLogRow, "id"> & { id?: string }) {
  const visitedAt = row.visitedAt instanceof Date ? row.visitedAt : new Date(row.visitedAt);
  const id = row.id ?? randomUUID();
  const key = monthKeyFromDate(visitedAt);
  const db = openMonthDb(key);
  db.prepare(
    `INSERT INTO visitor_logs (
      id, domain_id, domain_name, user_id, ip_address, url, method,
      user_agent, browser, os, country_code, country_name, referrer,
      status_code, is_bot, visited_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    row.domainId,
    row.domainName,
    row.userId,
    row.ipAddress,
    row.url,
    row.method,
    row.userAgent,
    row.browser,
    row.os,
    row.countryCode,
    row.countryName,
    row.referrer,
    row.statusCode,
    row.isBot ? 1 : 0,
    visitedAt.getTime()
  );
  maybePurgeOldVisitorDatabases();
  return id;
}

export function countVisitorLogs(filter: VisitorFilter, since?: Date, until?: Date) {
  const from = since ?? new Date(retentionCutoffMonth() + "-01T00:00:00.000Z");
  const to = until ?? new Date();
  const keys = monthsInRange(from, to);
  const fromMs = since?.getTime();
  const toMs = until?.getTime();
  let total = 0;
  for (const key of keys) {
    if (!fs.existsSync(dbPathForMonth(key))) continue;
    const db = openMonthDb(key);
    const { where, params } = buildWhere({ ...filter, fromMs, toMs });
    const row = db.prepare(`SELECT COUNT(*) AS c FROM visitor_logs ${where}`).get(...params) as {
      c: number;
    };
    total += Number(row.c ?? 0);
  }
  return total;
}

export function countUniqueVisitorIps(filter: VisitorFilter, since?: Date, until?: Date) {
  const from = since ?? new Date(retentionCutoffMonth() + "-01T00:00:00.000Z");
  const to = until ?? new Date();
  const keys = monthsInRange(from, to);
  const fromMs = since?.getTime();
  const toMs = until?.getTime();
  const ips = new Set<string>();
  for (const key of keys) {
    if (!fs.existsSync(dbPathForMonth(key))) continue;
    const db = openMonthDb(key);
    const { where, params } = buildWhere({ ...filter, fromMs, toMs });
    const rows = db
      .prepare(`SELECT DISTINCT ip_address FROM visitor_logs ${where}`)
      .all(...params) as Array<{ ip_address: string }>;
    for (const r of rows) ips.add(r.ip_address);
  }
  return ips.size;
}

export function groupVisitorCountsByDomain(
  filter: VisitorFilter,
  since: Date,
  limit = 5
): Array<{ domainId: string; count: number }> {
  const keys = monthsInRange(since, new Date());
  const fromMs = since.getTime();
  const totals = new Map<string, number>();
  for (const key of keys) {
    if (!fs.existsSync(dbPathForMonth(key))) continue;
    const db = openMonthDb(key);
    const { where, params } = buildWhere({ ...filter, fromMs });
    const rows = db
      .prepare(
        `SELECT domain_id, COUNT(*) AS c FROM visitor_logs ${where} GROUP BY domain_id`
      )
      .all(...params) as Array<{ domain_id: string; c: number }>;
    for (const r of rows) {
      totals.set(r.domain_id, (totals.get(r.domain_id) ?? 0) + Number(r.c));
    }
  }
  return [...totals.entries()]
    .map(([domainId, count]) => ({ domainId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function listVisitorLogs(
  filter: VisitorFilter & { limit?: number; from?: Date; to?: Date }
): VisitorListRow[] {
  const limit = Math.min(filter.limit ?? 100, 5000);
  const from = clampVisitorFromDate(filter.from) ?? new Date(retentionCutoffMonth() + "-01T00:00:00.000Z");
  const to = filter.to ?? new Date();
  const keys = monthsInRange(from, to).reverse();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const out: VisitorListRow[] = [];
  for (const key of keys) {
    if (out.length >= limit) break;
    if (!fs.existsSync(dbPathForMonth(key))) continue;
    const db = openMonthDb(key);
    const { where, params } = buildWhere({ ...filter, fromMs, toMs });
    const take = limit - out.length;
    const rows = db
      .prepare(
        `SELECT * FROM visitor_logs ${where} ORDER BY visited_at DESC LIMIT ?`
      )
      .all(...params, take) as Array<Record<string, unknown>>;
    out.push(...rows.map(rowFromDb));
  }
  out.sort((a, b) => b.visitedAt.getTime() - a.visitedAt.getTime());
  return out.slice(0, limit);
}

/** Delete monthly visitor DB files older than the retention window. */
export function purgeOldVisitorDatabases(): number {
  const cutoff = retentionCutoffMonth();
  let removed = 0;
  for (const key of listStoredMonthKeys()) {
    if (key >= cutoff) continue;
    const p = dbPathForMonth(key);
    const cached = dbCache.get(p);
    if (cached) {
      try {
        cached.close();
      } catch {
        /* ignore */
      }
      dbCache.delete(p);
    }
    try {
      fs.unlinkSync(p);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

function maybePurgeOldVisitorDatabases() {
  const now = Date.now();
  if (now - lastPurgeAt < 60 * 60 * 1000) return;
  lastPurgeAt = now;
  purgeOldVisitorDatabases();
}

export function visitorArchiveSummary() {
  const keys = listStoredMonthKeys().filter((k) => k >= retentionCutoffMonth());
  return {
    retentionMonths: VISITOR_RETENTION_MONTHS,
    months: keys,
    oldest: keys[0] ?? null,
    newest: keys.at(-1) ?? null,
  };
}
