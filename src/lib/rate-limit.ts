/**
 * In-memory login rate limiter (per process).
 * Keyed by IP + email, plus a coarser per-IP cap against email spraying.
 *
 * TRUST_PROXY (default true): use nginx X-Real-IP only. Do not trust
 * X-Forwarded-For — clients can spoof it. Set TRUST_PROXY=false if the
 * panel port is reachable without a proxy that overwrites X-Real-IP.
 */
type Bucket = {
  failures: number;
  firstAt: number;
  lockedUntil: number;
};

const buckets = new Map<string, Bucket>();
const ipBuckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const MAX_IP_FAILURES = 25;
const LOCKOUT_MS = 15 * 60 * 1000;

function keyFor(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

function trustProxyHeaders(): boolean {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
}

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

function assertBucket(map: Map<string, Bucket>, key: string, message: string): void {
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
const totpBuckets = new Map<string, Bucket>();
const TOTP_WINDOW_MS = 15 * 60 * 1000;
const TOTP_MAX_FAILURES = 5;
const TOTP_LOCKOUT_MS = 15 * 60 * 1000;

function totpKey(ip: string, userId: string): string {
  return `2fa|${ip}|${userId}`;
}

export function assertTotpAllowed(ip: string, userId: string): void {
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
