#!/usr/bin/env node
/**
 * Parse nginx access logs (with $host) and POST visits to Naviyra Security ingest.
 *
 * Usage:
 *   node scripts/parse-nginx-visitors.mjs [log-file ...]
 *
 * Always posts to http://127.0.0.1:$PANEL_PORT (ignores public PANEL_URL).
 */
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
    /* no .env */
  }
}

loadDotEnv();

const panelPort = process.env.PANEL_PORT?.trim() || "3100";
const PANEL_URL = `http://127.0.0.1:${panelPort}`;
const KEY =
  process.env.SECURITY_INGEST_KEY ||
  process.env.AGENT_API_KEY ||
  "";
if (!KEY) {
  console.error("Set SECURITY_INGEST_KEY or AGENT_API_KEY.");
  process.exit(1);
}
const STATE_FILE =
  process.env.STATE_FILE ||
  path.join(process.cwd(), "data", "nginx-visitor-offset.json");
const PANEL_HOST = (process.env.PANEL_HOSTNAME || "")
  .trim()
  .toLowerCase()
  .replace(/^www\./, "");

const DEDICATED = "/var/log/nginx/naviyra-visitors.log";
const DEFAULT_ACCESS = process.env.NGINX_ACCESS_LOG || "/var/log/nginx/access.log";

function defaultLogFiles() {
  if (fs.existsSync(DEDICATED)) return [DEDICATED];
  return [DEFAULT_ACCESS];
}

const LOGS = (process.argv.slice(2).filter(Boolean).length
  ? process.argv.slice(2)
  : defaultLogFiles()
).filter((file) => fs.existsSync(file));

// Combined + optional host:  '... "$http_user_agent" "$host"'
const LINE_RE =
  /^(\S+) \S+ \S+ \[([^\]]+)] "(\S+) ([^"]*?)(?: HTTP\/[\d.]+)?" (\d{3}) \S+ "([^"]*)" "([^"]*)"(?: "([^"]*)")?/;

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (raw && raw.files && typeof raw.files === "object") return raw;
    return { files: { [DEFAULT_ACCESS]: { offset: raw.offset || 0, inode: raw.inode ?? null } } };
  } catch {
    return { files: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function looksLikeHost(value) {
  if (!value || value === "-" || value === "localhost") return false;
  if (value.startsWith("127.") || value === "::1") return false;
  const host = value.toLowerCase().split(":")[0];
  return host.includes(".");
}

function isPanelHost(host) {
  if (!PANEL_HOST || !host) return false;
  const h = host.toLowerCase().split(":")[0].replace(/^www\./, "");
  return h === PANEL_HOST;
}

function parseLine(line) {
  const m = line.match(LINE_RE);
  if (!m) return null;
  const [, ip, , method, url, status, referrer, ua, hostField] = m;
  const host = looksLikeHost(hostField) ? hostField.split(":")[0] : "";
  if (!host) return null;
  // Panel UI noise only — keep /api on customer sites (scanners, apps).
  if (isPanelHost(host)) {
    if (
      url.startsWith("/_next/") ||
      url.startsWith("/api/") ||
      url.startsWith("/terminal-ws/")
    ) {
      return null;
    }
  }
  if (url === "/favicon.ico" || url.startsWith("/.well-known/")) {
    return null;
  }
  return {
    host,
    ipAddress: ip,
    url,
    method,
    userAgent: ua === "-" ? undefined : ua,
    referrer: referrer === "-" ? undefined : referrer,
    statusCode: Number(status),
  };
}

function readNewLines(file, state) {
  const stat = fs.statSync(file);
  const prev = state.files[file] || { offset: 0, inode: null };
  let offset = prev.offset || 0;
  if (prev.inode && prev.inode !== stat.ino) offset = 0;
  if (offset > stat.size) offset = 0;
  const length = stat.size - offset;
  state.files[file] = { offset: stat.size, inode: stat.ino };
  if (length <= 0) return [];
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, offset);
  fs.closeSync(fd);
  return buf.toString("utf8").split(/\r?\n/).filter(Boolean);
}

async function main() {
  if (LOGS.length === 0) {
    console.log("No nginx access logs found");
    return;
  }

  const state = readState();
  const lines = [];
  for (const file of LOGS) {
    lines.push(...readNewLines(file, state));
  }

  const events = [];
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev) events.push(ev);
  }

  if (events.length === 0) {
    writeState(state);
    console.log(
      `Parsed ${lines.length} lines from ${LOGS.join(", ")}, 0 visits to ingest`
    );
    return;
  }

  let logged = 0;
  let skipped = 0;
  for (let i = 0; i < events.length; i += 200) {
    const chunk = events.slice(i, i + 200);
    let res;
    try {
      res = await fetch(`${PANEL_URL}/api/security/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({ events: chunk }),
      });
    } catch (err) {
      const code = err && typeof err === "object" && "cause" in err
        ? err.cause?.code
        : err?.code;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        code === "ECONNREFUSED" ||
        /ECONNREFUSED/.test(msg) ||
        /fetch failed/i.test(msg)
      ) {
        console.log(`Panel not listening on ${PANEL_URL} — skip ingest until next timer.`);
        return;
      }
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Ingest failed", res.status, data, "url=", PANEL_URL);
      process.exit(1);
    }
    logged += data.logged || 0;
    skipped += data.skipped || 0;
  }

  writeState(state);

  console.log(
    `Ingested visits: logged=${logged} skipped=${skipped} from ${events.length} events (${lines.length} lines)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
