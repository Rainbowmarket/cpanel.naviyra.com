import net from "node:net";
import { isValidDnsLabel, isValidHostname, normalizeHostnameInput } from "@/lib/hostname";
import type { DnsRecordInput } from "@/lib/dns/zone";

const CTRL_OR_ZONE_META = /[\r\n\0\t]|\$/;

function rejectInjection(raw: string, field: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`${field} is required`);
  if (CTRL_OR_ZONE_META.test(value) || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${field} contains invalid characters`);
  }
  return value;
}

/** Relative owner name for a zone (@, label, or multi-label left-hand side). */
export function assertSafeDnsRecordName(name: string): string {
  const value = rejectInjection(name, "Record name").toLowerCase().replace(/\.$/, "");
  if (value === "@") return "@";

  // Allow FQDN that will be relativized later, or relative labels.
  if (value.includes(".")) {
    const parts = value.split(".");
    if (!parts.every(isValidDnsLabel)) {
      throw new Error(
        "Record name must use valid DNS labels (letters, numbers, hyphens)"
      );
    }
    if (value.length > 253) throw new Error("Record name is too long");
    return value;
  }

  if (!isValidDnsLabel(value)) {
    throw new Error(
      "Record name must be @ or a valid DNS label (e.g. www, mail)"
    );
  }
  return value;
}

function assertHostnameValue(value: string, field: string): string {
  const cleaned = rejectInjection(value, field).replace(/\.$/, "");
  const host = normalizeHostnameInput(cleaned);
  // Single-label relative targets (e.g. mail) are OK for MX/CNAME in-zone.
  if (!host.includes(".")) {
    if (!isValidDnsLabel(host)) {
      throw new Error(`${field} must be a valid hostname`);
    }
    return host;
  }
  if (!isValidHostname(host)) {
    throw new Error(`${field} must be a valid hostname`);
  }
  return host;
}

function assertTxtValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("TXT value is required");
  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error("TXT value cannot contain newlines");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(trimmed)) {
    throw new Error("TXT value contains invalid characters");
  }
  if (trimmed.length > 2048) {
    throw new Error("TXT value is too long");
  }
  return trimmed;
}

export function assertSafeDnsRecord(
  input: Pick<DnsRecordInput, "name" | "type" | "value"> & {
    ttl?: number;
    priority?: number;
  }
): DnsRecordInput {
  const name = assertSafeDnsRecordName(input.name);
  const type = input.type;

  let value: string;
  switch (type) {
    case "A": {
      const ip = rejectInjection(input.value, "A record value");
      if (net.isIP(ip) !== 4) {
        throw new Error("A record value must be a valid IPv4 address");
      }
      value = ip;
      break;
    }
    case "AAAA": {
      const ip = rejectInjection(input.value, "AAAA record value");
      if (net.isIP(ip) !== 6) {
        throw new Error("AAAA record value must be a valid IPv6 address");
      }
      value = ip;
      break;
    }
    case "CNAME":
      value = assertHostnameValue(input.value, "CNAME target");
      break;
    case "MX":
      value = assertHostnameValue(input.value, "MX target");
      break;
    case "TXT":
      value = assertTxtValue(input.value);
      break;
    default:
      throw new Error("Unsupported record type");
  }

  if (input.ttl !== undefined) {
    if (!Number.isInteger(input.ttl) || input.ttl < 60 || input.ttl > 86400 * 7) {
      throw new Error("TTL must be between 60 and 604800 seconds");
    }
  }
  if (type === "MX" && input.priority !== undefined) {
    if (
      !Number.isInteger(input.priority) ||
      input.priority < 0 ||
      input.priority > 65535
    ) {
      throw new Error("MX priority must be 0–65535");
    }
  }

  return {
    name,
    type,
    value,
    ttl: input.ttl,
    priority: input.priority,
  };
}
