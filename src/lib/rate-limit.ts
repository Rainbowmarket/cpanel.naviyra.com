/**
 * In-memory login rate limiter (per process).
 * Keyed by IP + email to slow credential stuffing.
 */
type Bucket = {
  failures: number;
  firstAt: number;
  lockedUntil: number;
};

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function keyFor(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

/**
 * Client IP for rate limiting. Prefer nginx X-Real-IP ($remote_addr).
 * Never use the leftmost X-Forwarded-For hop — clients can spoof it when
 * the proxy appends the real address.
 */
export function getClientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;

  const xf = request.headers.get("x-forwarded-for");
  if (xf) {
    const parts = xf
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // Rightmost hop is typically added by the nearest trusted proxy.
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return "unknown";
}

export function assertLoginAllowed(ip: string, email: string): void {
  const key = keyFor(ip, email);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket) return;

  if (bucket.lockedUntil > now) {
    const mins = Math.ceil((bucket.lockedUntil - now) / 60000);
    throw new Error(`Too many failed attempts. Try again in ${mins} minute(s).`);
  }

  if (now - bucket.firstAt > WINDOW_MS) {
    buckets.delete(key);
  }
}

export function recordLoginFailure(ip: string, email: string): void {
  const key = keyFor(ip, email);
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now - existing.firstAt > WINDOW_MS) {
    buckets.set(key, { failures: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  existing.failures += 1;
  if (existing.failures >= MAX_FAILURES) {
    existing.lockedUntil = now + LOCKOUT_MS;
  }
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
