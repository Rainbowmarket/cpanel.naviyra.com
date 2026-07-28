#!/usr/bin/env node
/**
 * Parse nginx access logs (with $host) and POST visits to Naviyra Security ingest.
 *
 * Usage:
 *   node scripts/parse-nginx-visitors.mjs [/var/log/nginx/access.log]
 *
 * Env:
 *   PANEL_URL=http://127.0.0.1:3100
 *   SECURITY_INGEST_KEY=...   (or AGENT_API_KEY)
 *   STATE_FILE=/opt/naviyra-panel/data/nginx-visitor-offset.json
 */
import fs from "node:fs";
import path from "node:path";

const LOG =
  process.argv[2] ||
  process.env.NGINX_ACCESS_LOG ||
  "/var/log/nginx/access.log";
const PANEL_URL = (process.env.PANEL_URL || "http://127.0.0.1:3100").replace(
  /\/$/,
  ""
);
const KEY =
  process.env.SECURITY_INGEST_KEY ||
  process.env.AGENT_API_KEY ||
  "naviyra-local-agent-key";
const STATE_FILE =
  process.env.STATE_FILE ||
  path.join(process.cwd(), "data", "nginx-visitor-offset.json");

// Combined + host:  '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$host"'
const LINE_RE =
  /^(\S+) \S+ \S+ \[([^\]]+)] "(\S+) ([^"]*?)(?: HTTP\/[\d.]+)?" (\d{3}) \S+ "([^"]*)" "([^"]*)"(?: "([^"]*)")?/;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { offset: 0, inode: null };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function parseLine(line) {
  const m = line.match(LINE_RE);
  if (!m) return null;
  const [, ip, , method, url, status, referrer, ua, host] = m;
  if (!host || host === "-" || host === "localhost" || host.startsWith("127.")) {
    return null;
  }
  // Skip panel / static noise
  if (
    url.startsWith("/_next/") ||
    url.startsWith("/api/") ||
    url === "/favicon.ico" ||
    url.startsWith("/.well-known/")
  ) {
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

async function main() {
  if (!fs.existsSync(LOG)) {
    console.error("Log not found:", LOG);
    process.exit(0);
  }

  const stat = fs.statSync(LOG);
  const state = readState();
  let offset = state.offset || 0;
  if (state.inode && state.inode !== stat.ino) offset = 0;
  if (offset > stat.size) offset = 0;

  const fd = fs.openSync(LOG, "r");
  const length = stat.size - offset;
  if (length <= 0) {
    fs.closeSync(fd);
    console.log("No new log lines");
    return;
  }

  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, offset);
  fs.closeSync(fd);

  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev) events.push(ev);
  }

  writeState({ offset: stat.size, inode: stat.ino });

  if (events.length === 0) {
    console.log("Parsed", lines.length, "lines, 0 visits to ingest");
    return;
  }

  // Batch in chunks of 200
  let logged = 0;
  let skipped = 0;
  for (let i = 0; i < events.length; i += 200) {
    const chunk = events.slice(i, i + 200);
    const res = await fetch(`${PANEL_URL}/api/security/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ events: chunk }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Ingest failed", res.status, data);
      process.exit(1);
    }
    logged += data.logged || 0;
    skipped += data.skipped || 0;
  }

  console.log(
    `Ingested visits: logged=${logged} skipped=${skipped} from ${events.length} events (${lines.length} lines)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
