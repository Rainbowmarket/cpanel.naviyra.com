#!/usr/bin/env node
/** Delete monthly visitor DB files older than VISITOR_RETENTION_MONTHS (default 6). */
import fs from "node:fs";
import path from "node:path";

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === "") process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

loadDotEnv();

const RETENTION = Math.max(1, Number(process.env.VISITOR_RETENTION_MONTHS ?? 6) || 6);
const dir =
  process.env.VISITOR_DATA_DIR?.trim() || path.join(process.cwd(), "data", "visitors");

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function retentionCutoffMonth() {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - RETENTION);
  return monthKey(d);
}

function listStoredMonthKeys() {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.db$/.test(f))
    .map((f) => f.replace(/\.db$/, ""))
    .sort();
}

const cutoff = retentionCutoffMonth();
let removed = 0;
for (const key of listStoredMonthKeys()) {
  if (key >= cutoff) continue;
  try {
    fs.unlinkSync(path.join(dir, `${key}.db`));
    removed += 1;
  } catch {
    /* ignore */
  }
}

const months = listStoredMonthKeys().filter((k) => k >= cutoff);
console.log(
  JSON.stringify({ ok: true, removed, retentionMonths: RETENTION, months })
);
