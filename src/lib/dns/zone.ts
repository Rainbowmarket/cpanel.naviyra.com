export type DnsRecordInput = {
  name: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT";
  value: string;
  ttl?: number;
  priority?: number;
};

export type DnsZoneConfig = {
  domain: string;
  serial: number;
  ns1: string;
  ns2: string;
  adminEmail?: string;
  defaultTtl?: number;
  records: DnsRecordInput[];
};

function formatRecordName(name: string, domain: string): string {
  if (name === "@" || name === "" || name === domain) return "@";
  if (name.endsWith(`.${domain}`)) {
    return name.slice(0, -(domain.length + 1));
  }
  return name;
}

function formatRecordValue(value: string, type: DnsRecordInput["type"]): string {
  if (type === "TXT") {
    const trimmed = value.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }
  if ((type === "MX" || type === "CNAME") && !value.endsWith(".")) {
    return `${value}.`;
  }
  return value;
}

function recordLine(record: DnsRecordInput, domain: string, defaultTtl: number): string {
  const ttl = record.ttl ?? defaultTtl;
  const name = formatRecordName(record.name, domain);
  const label = name === "@" ? "@" : name;
  const value = formatRecordValue(record.value, record.type);

  if (record.type === "MX") {
    const priority = record.priority ?? 10;
    return `${label.padEnd(8)} ${ttl} IN MX ${priority} ${value}`;
  }

  return `${label.padEnd(8)} ${ttl} IN ${record.type} ${value}`;
}

export function buildZoneFile(config: DnsZoneConfig): string {
  const ttl = config.defaultTtl ?? 86400;
  const admin = config.adminEmail ?? `admin.${config.domain}`;
  const serial = config.serial;

  const lines = [
    `$TTL ${ttl}`,
    `@       IN  SOA ${config.ns1}. ${admin}. (`,
    `                ${serial} ; serial`,
    "                3600       ; refresh",
    "                1800       ; retry",
    "                604800     ; expire",
    "                86400 )    ; minimum",
    "",
    `@       IN  NS  ${config.ns1}.`,
    `@       IN  NS  ${config.ns2}.`,
    "",
  ];

  for (const record of config.records) {
    lines.push(recordLine(record, config.domain, ttl));
  }

  lines.push("");
  return lines.join("\n");
}

export function buildNamedZoneBlock(domain: string, zoneFilePath: string): string {
  return [
    `zone "${domain}" {`,
    "    type master;",
    `    file "${zoneFilePath.replace(/\\/g, "/")}";`,
    "};",
    "",
  ].join("\n");
}

export function defaultDomainRecords(ipAddress: string): DnsRecordInput[] {
  return [
    { name: "@", type: "A", value: ipAddress },
    { name: "www", type: "A", value: ipAddress },
  ];
}

export function subdomainRecord(name: string, ipAddress: string): DnsRecordInput {
  return { name, type: "A", value: ipAddress };
}

/** Relative label for a mail host inside the domain zone, or null if external. */
export function mailHostLabel(mailHost: string, domainName: string): string | null {
  if (mailHost === domainName) return "@";
  const suffix = `.${domainName}`;
  if (mailHost.endsWith(suffix)) {
    return mailHost.slice(0, -suffix.length) || "@";
  }
  return null;
}

export function mailDnsRecords(
  domainName: string,
  ipAddress: string,
  mailHost: string
): DnsRecordInput[] {
  const records: DnsRecordInput[] = [
    { name: "@", type: "MX", value: mailHost, priority: 10 },
    { name: "@", type: "TXT", value: `v=spf1 a mx ip4:${ipAddress} ~all` },
  ];

  const mailLabel = mailHostLabel(mailHost, domainName);
  if (mailLabel && mailLabel !== "@") {
    records.push({ name: mailLabel, type: "A", value: ipAddress });
  }

  return records;
}
