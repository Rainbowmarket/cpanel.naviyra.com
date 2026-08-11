import net from "node:net";

/** True for IPv4 or IPv6 (including compressed forms). Rejects hostnames and junk. */
export function isValidIpAddress(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed || /[\s\r\n\0#;]/.test(trimmed)) return false;
  return net.isIP(trimmed) !== 0;
}

export function assertValidIpAddress(ip: string, label = "IP address"): string {
  const trimmed = ip.trim();
  if (!isValidIpAddress(trimmed)) {
    throw new Error(`${label} must be a valid IPv4 or IPv6 address`);
  }
  return trimmed;
}

/**
 * Single-line reason safe for nginx comments / deny-file append.
 * Rejects control chars and nginx-sensitive punctuation that could close the comment.
 */
export function sanitizeBlockReason(reason: string, maxLen = 200): string {
  const cleaned = reason
    .replace(/[\r\n\0]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[;{}]/g, "")
    .trim()
    .slice(0, maxLen);
  if (!cleaned) {
    throw new Error("Block reason is required");
  }
  return cleaned;
}
