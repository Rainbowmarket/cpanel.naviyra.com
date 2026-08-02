import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality for UTF-8 strings (e.g. API keys / bearer tokens).
 * Length mismatch returns false without leaking which side was longer via
 * early exit on content compare — still short-circuits on length, which is
 * unavoidable for unequal-length secrets with timingSafeEqual.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Accept Authorization: Bearer <token> with timing-safe compare. */
export function bearerTokenMatches(
  authorizationHeader: string | null | undefined,
  expectedToken: string
): boolean {
  const header = authorizationHeader ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return timingSafeEqualString(match[1]!.trim(), expectedToken);
}
