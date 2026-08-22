import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { PROJECT_ROOT } from "./paths";

const WINDOW_MS = 60_000;
const LOOPBACK_MAX = 600;
const REMOTE_MAX = 40;
const AUDIT_FILE = path.join(PROJECT_ROOT, "data", "agent-audit.log");

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function isLoopback(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.")
  );
}

export function clientIp(req: http.IncomingMessage): string {
  const raw = req.socket.remoteAddress || "unknown";
  return raw.replace("::ffff:", "");
}

export function assertAgentRateLimit(req: http.IncomingMessage, route: string): void {
  const ip = clientIp(req);
  const max = isLoopback(ip) ? LOOPBACK_MAX : REMOTE_MAX;
  const key = `${ip}|${route}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) {
    throw new Error("Rate limit exceeded");
  }
}

export function auditAgentEvent(input: {
  route: string;
  ip: string;
  action?: string;
  ok: boolean;
  detail?: string;
  payload?: Record<string, unknown>;
}): void {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...input,
    }) + "\n";
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.appendFileSync(AUDIT_FILE, line);
  } catch {
    console.warn("[audit]", line.trim());
  }
}

export function tooMany(res: http.ServerResponse, error: string) {
  res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
  res.end(JSON.stringify({ success: false, error }));
}
