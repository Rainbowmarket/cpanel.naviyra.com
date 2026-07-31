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

export function getClientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
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
