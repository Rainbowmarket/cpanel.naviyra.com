import { trustProxyHeaders } from "@/lib/proxy-trust";

/**
 * In-memory login rate limiter (per process).
 * Keyed by IP + email, plus a coarser per-IP cap against email spraying.
 *
 * TRUST_PROXY (default false): only use nginx X-Real-IP when explicitly enabled.
 * Do not trust X-Forwarded-For — clients can spoof it. Set TRUST_PROXY=true only
 * when the panel is behind a proxy that overwrites X-Real-IP with $remote_addr
 * and PANEL_PORT is not exposed publicly.
 */
type Bucket = {
  failures: number;
  firstAt: number;
  lockedUntil: number;
};

const buckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();
const totpBuckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const MAX_IP_FAILURES = 25;
const LOCKOUT_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BUCKET_ENTRIES = 10_000;
const TOTP_WINDOW_MS = 15 * 60 * 1000;
const TOTP_MAX_FAILURES = 5;
const TOTP_LOCKOUT_MS = 15 * 60 * 1000;

let lastSweepAt = 0;

function keyFor(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

export { trustProxyHeaders };

/**
 * Client IP for rate limiting. Prefer nginx X-Real-IP ($remote_addr),
 * which overwrites the client header. Ignore X-Forwarded-For.
 */
export function getClientIp(request: Request): string {
  if (!trustProxyHeaders()) return "direct";

  const real = request.headers.get("x-real-ip")?.trim();
  if (real && /^[\d.:a-fA-F]+$/.test(real) && real.length <= 45) return real;

  return "unknown";
}

function sweepStaleBuckets(now = Date.now()): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  const drop = (map: Map<string, Bucket>) => {
    for (const [key, bucket] of map) {
      const idle = now - bucket.firstAt > WINDOW_MS && bucket.lockedUntil <= now;
      if (idle) map.delete(key);
    }
    if (map.size <= MAX_BUCKET_ENTRIES) return;
    // Spray defense: drop oldest unlocked entries first.
    const entries = [...map.entries()].sort(
      (a, b) => a[1].firstAt - b[1].firstAt
    );
    for (const [key, bucket] of entries) {
      if (map.size <= MAX_BUCKET_ENTRIES) break;
      if (bucket.lockedUntil > now) continue;
      map.delete(key);
    }
  };

  drop(buckets);
  drop(ipBuckets);
  drop(totpBuckets);
}

function assertBucket(map: Map<string, Bucket>, key: string, message: string): void {
  sweepStaleBuckets();
  const now = Date.now();
  const bucket = map.get(key);
  if (!bucket) return;

  if (bucket.lockedUntil > now) {
    const mins = Math.ceil((bucket.lockedUntil - now) / 60000);
    throw new Error(message.replace("{mins}", String(mins)));
  }

  if (now - bucket.firstAt > WINDOW_MS) {
    map.delete(key);
  }
}

function recordBucket(
  map: Map<string, Bucket>,
  key: string,
  maxFailures: number
): void {
  sweepStaleBuckets();
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || now - existing.firstAt > WINDOW_MS) {
    map.set(key, { failures: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  existing.failures += 1;
  if (existing.failures >= maxFailures) {
    existing.lockedUntil = now + LOCKOUT_MS;
  }
}

export function assertLoginAllowed(ip: string, email: string): void {
  assertBucket(
    ipBuckets,
    ip,
    "Too many failed attempts from this IP. Try again in {mins} minute(s)."
  );
  assertBucket(
    buckets,
    keyFor(ip, email),
    "Too many failed attempts. Try again in {mins} minute(s)."
  );
}

export function recordLoginFailure(ip: string, email: string): void {
  recordBucket(ipBuckets, ip, MAX_IP_FAILURES);
  recordBucket(buckets, keyFor(ip, email), MAX_FAILURES);
}

export function clearLoginFailures(ip: string, email: string): void {
  buckets.delete(keyFor(ip, email));
}

/** Separate TOTP / backup-code brute-force limiter (IP + userId). */
function totpKey(ip: string, userId: string): string {
  return `2fa|${ip}|${userId}`;
}

export function assertTotpAllowed(ip: string, userId: string): void {
  sweepStaleBuckets();
  const key = totpKey(ip, userId);
  const now = Date.now();
  const bucket = totpBuckets.get(key);
  if (!bucket) return;

  if (bucket.lockedUntil > now) {
    const mins = Math.ceil((bucket.lockedUntil - now) / 60000);
    throw new Error(`Too many failed 2FA attempts. Try again in ${mins} minute(s).`);
  }

  if (now - bucket.firstAt > TOTP_WINDOW_MS) {
    totpBuckets.delete(key);
  }
}

export function recordTotpFailure(ip: string, userId: string): void {
  sweepStaleBuckets();
  const key = totpKey(ip, userId);
  const now = Date.now();
  const existing = totpBuckets.get(key);
  if (!existing || now - existing.firstAt > TOTP_WINDOW_MS) {
    totpBuckets.set(key, { failures: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  existing.failures += 1;
  if (existing.failures >= TOTP_MAX_FAILURES) {
    existing.lockedUntil = now + TOTP_LOCKOUT_MS;
  }
}

export function clearTotpFailures(ip: string, userId: string): void {
  totpBuckets.delete(totpKey(ip, userId));
}
