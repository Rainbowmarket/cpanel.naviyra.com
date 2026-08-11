import net from "node:net";

export function assertValidIpAddress(ip: string): string {
  const trimmed = String(ip ?? "").trim();
  if (!trimmed || /[\s\r\n\0#;]/.test(trimmed) || net.isIP(trimmed) === 0) {
    throw new Error("IP must be a valid IPv4 or IPv6 address");
  }
  return trimmed;
}

export function sanitizeBlockReason(reason: string, maxLen = 200): string {
  const cleaned = String(reason ?? "")
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
