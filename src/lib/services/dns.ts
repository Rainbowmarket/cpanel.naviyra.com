import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { getDnsNs1, getDnsNs2, getMailHostname, getServerPublicIp } from "@/lib/paths";
import { agentTargetForServerId } from "@/lib/agent/target";
import {
  buildZoneFile,
  defaultDomainRecords,
  mailDnsRecords,
  mailHostLabel,
  type DnsRecordInput,
} from "@/lib/dns/zone";
import { assertSafeDnsRecord } from "@/lib/dns/validate";
import { domainAccessWhere } from "@/lib/hosting-targets";

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT"] as const;
export type DnsRecordType = (typeof RECORD_TYPES)[number];

function serialFromDate(): number {
  const now = new Date();
  return (
    now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
  );
}

async function loadDomainWithZone(domainId: string, userId?: string) {
  return prisma.domain.findFirstOrThrow({
    where: {
      id: domainId,
      ...(userId
        ? domainAccessWhere({ id: userId, role: "USER" }, "dns")
        : {}),
    },
    include: {
      server: true,
      subdomains: true,
      dnsZone: { include: { records: true } },
    },
  });
}

function toRecordInputs(
  records: Array<{
    name: string;
    type: string;
    value: string;
    ttl: number;
    priority: number | null;
  }>
): DnsRecordInput[] {
  return records.map((record) => ({
    name: record.name,
    type: record.type as DnsRecordInput["type"],
    value: record.value,
    ttl: record.ttl,
    priority: record.priority ?? undefined,
  }));
}

function normalizeRecordName(name: string, domainName: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "@" || trimmed === domainName) return "@";
  if (trimmed.endsWith(`.${domainName}`)) {
    return trimmed.slice(0, -(domainName.length + 1)) || "@";
  }
  return trimmed.replace(/\.$/, "");
}

async function upsertZoneRecord(
  zoneId: string,
  record: {
    name: string;
    type: string;
    value: string;
    ttl?: number;
    priority?: number | null;
  }
) {
  return prisma.dnsRecord.upsert({
    where: {
      zoneId_name_type_value: {
        zoneId,
        name: record.name,
        type: record.type,
        value: record.value,
      },
    },
    create: {
      zoneId,
      name: record.name,
      type: record.type,
      value: record.value,
      ttl: record.ttl ?? 86400,
      priority: record.priority ?? null,
    },
    update: {
      ttl: record.ttl ?? 86400,
      priority: record.priority ?? null,
    },
  });
}

async function upsertSubdomainRecord(
  zoneId: string,
  name: string,
  ipAddress: string
) {
  const existing = await prisma.dnsRecord.findFirst({
    where: { zoneId, name, type: "A" },
  });

  if (existing) {
    if (existing.value === ipAddress) return existing;
    return prisma.dnsRecord.update({
      where: { id: existing.id },
      data: { value: ipAddress },
    });
  }

  return prisma.dnsRecord.create({
    data: { zoneId, name, type: "A", value: ipAddress },
  });
}

function resolveDomainIp(serverIp: string): string {
  return getServerPublicIp(serverIp);
}

async function refreshAutoManagedRecords(
  zoneId: string,
  domainName: string,
  ipAddress: string
) {
  await upsertSubdomainRecord(zoneId, "@", ipAddress);
  await upsertSubdomainRecord(zoneId, "www", ipAddress);

  // Glue A records for in-zone nameservers (required for BIND to load the zone)
  for (const nsHost of [getDnsNs1(), getDnsNs2()]) {
    const label = mailHostLabel(nsHost.toLowerCase(), domainName.toLowerCase());
    if (label && label !== "@") {
      await upsertSubdomainRecord(zoneId, label, ipAddress);
    }
  }

  const mailHost = getMailHostname(domainName);
  for (const record of mailDnsRecords(domainName, ipAddress, mailHost)) {
    if (record.type === "A") {
      await upsertSubdomainRecord(zoneId, record.name, ipAddress);
    } else if (record.type === "MX") {
      const existing = await prisma.dnsRecord.findFirst({
        where: { zoneId, name: record.name, type: "MX" },
      });
      if (!existing) {
        await upsertZoneRecord(zoneId, {
          name: record.name,
          type: "MX",
          value: record.value,
          priority: record.priority ?? 10,
        });
      }
    } else if (record.type === "TXT" && record.value.startsWith("v=spf1")) {
      await prisma.dnsRecord.deleteMany({
        where: { zoneId, name: "@", type: "TXT", value: { startsWith: "v=spf1" } },
      });
      await upsertZoneRecord(zoneId, {
        name: "@",
        type: "TXT",
        value: record.value,
      });
    }
  }
}

export async function listDnsZones(
  userId: string,
  role?: "ADMIN" | "USER"
) {
  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "dns"
  );
  return prisma.dnsZone.findMany({
    where: { domain: access },
    include: {
      domain: {
        select: { id: true, name: true, status: true, server: { select: { ipAddress: true } } },
      },
      records: { orderBy: [{ name: "asc" }, { type: "asc" }] },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/** Create missing zones for hosted domains so DNS is not empty until mail is added. */
export async function ensureDnsZonesForAccessibleDomains(
  userId: string,
  role?: "ADMIN" | "USER"
) {
  const access = domainAccessWhere(
    { id: userId, role: role === "ADMIN" ? "ADMIN" : "USER" },
    "dns"
  );
  const domains = await prisma.domain.findMany({
    where: access,
    select: { id: true, dnsZone: { select: { id: true } } },
  });

  for (const domain of domains) {
    if (domain.dnsZone) continue;
    try {
      await syncDnsZone(domain.id);
    } catch (error) {
      console.error("DNS zone ensure failed:", domain.id, error);
      try {
        await ensureDnsZone(domain.id);
      } catch (inner) {
        console.error("DNS zone create failed:", domain.id, inner);
      }
    }
  }
}

export async function ensureDnsZone(domainId: string) {
  const domain = await loadDomainWithZone(domainId);
  if (domain.dnsZone) return domain.dnsZone;

  const defaults = defaultDomainRecords(resolveDomainIp(domain.server.ipAddress));

  return prisma.dnsZone.create({
    data: {
      domainId,
      serial: serialFromDate(),
      records: {
        create: defaults.map((record) => ({
          name: record.name,
          type: record.type,
          value: record.value,
          ttl: record.ttl ?? 86400,
          priority: record.priority,
        })),
      },
    },
    include: { records: true },
  });
}

export async function syncDnsZone(domainId: string, userId?: string) {
  await ensureDnsZone(domainId);
  const domain = await loadDomainWithZone(domainId, userId);
  const zoneId = domain.dnsZone!.id;
  const ipAddress = resolveDomainIp(domain.server.ipAddress);

  await refreshAutoManagedRecords(zoneId, domain.name, ipAddress);

  for (const sub of domain.subdomains) {
    await upsertSubdomainRecord(zoneId, sub.name, ipAddress);
  }

  const zone = await prisma.dnsZone.findUniqueOrThrow({
    where: { id: zoneId },
    include: { records: true },
  });

  const serial = serialFromDate();
  const ns1 = getDnsNs1();
  const ns2 = getDnsNs2();
  const records = toRecordInputs(zone.records);
  const zoneContent = buildZoneFile({
    domain: domain.name,
    serial,
    ns1,
    ns2,
    records,
  });

  const agentResult = await callAgent(
    {
      action: "sync_dns_zone",
      domain: domain.name,
      serial,
      ns1,
      ns2,
      ipAddress,
      records: records.map((record) => ({
        name: record.name,
        type: record.type,
        value: record.value,
        ttl: record.ttl,
        priority: record.priority,
      })),
      zoneContent,
    },
    await agentTargetForServerId(domain.serverId)
  );

  return prisma.dnsZone.update({
    where: { id: zone.id },
    data: {
      serial,
      syncedAt: agentResult.success ? new Date() : zone.syncedAt,
      lastError: agentResult.success ? null : (agentResult.error ?? "DNS sync failed"),
    },
    include: {
      records: true,
      domain: { select: { id: true, name: true, status: true } },
    },
  });
}

export async function addSubdomainDnsRecord(domainId: string, subdomainName: string) {
  await ensureDnsZone(domainId);
  const domain = await loadDomainWithZone(domainId);
  const zoneId = domain.dnsZone!.id;

  await upsertSubdomainRecord(
    zoneId,
    subdomainName,
    resolveDomainIp(domain.server.ipAddress)
  );

  return syncDnsZone(domainId);
}

export async function ensureMailDnsRecords(domainId: string, userId?: string) {
  await ensureDnsZone(domainId);
  const domain = await loadDomainWithZone(domainId, userId);
  const zoneId = domain.dnsZone!.id;
  const mailHost = getMailHostname(domain.name);
  const records = mailDnsRecords(
    domain.name,
    resolveDomainIp(domain.server.ipAddress),
    mailHost
  );

  for (const record of records) {
    await upsertZoneRecord(zoneId, record);
  }

  return syncDnsZone(domainId, userId);
}

export async function addDnsRecord(
  domainId: string,
  userId: string,
  input: {
    name: string;
    type: DnsRecordType;
    value: string;
    ttl?: number;
    priority?: number;
  }
) {
  if (!RECORD_TYPES.includes(input.type)) {
    throw new Error("Unsupported record type");
  }

  const domain = await loadDomainWithZone(domainId, userId);
  if (!domain.dnsZone) {
    await ensureDnsZone(domainId);
  }

  const zone = await loadDomainWithZone(domainId, userId);
  const zoneId = zone.dnsZone!.id;
  const safe = assertSafeDnsRecord(input);
  const name = normalizeRecordName(safe.name, zone.name);
  if (safe.type === "MX" && safe.priority === undefined) {
    throw new Error("MX records require a priority");
  }

  await upsertZoneRecord(zoneId, {
    name,
    type: safe.type,
    value: safe.value,
    ttl: safe.ttl,
    priority: safe.type === "MX" ? (safe.priority ?? 10) : null,
  });

  return syncDnsZone(domainId, userId);
}

export async function updateDnsRecord(
  recordId: string,
  userId: string,
  input: {
    name: string;
    type: DnsRecordType;
    value: string;
    ttl?: number;
    priority?: number;
  }
) {
  if (!RECORD_TYPES.includes(input.type)) {
    throw new Error("Unsupported record type");
  }

  const record = await prisma.dnsRecord.findFirstOrThrow({
    where: {
      id: recordId,
      zone: {
        domain: domainAccessWhere({ id: userId, role: "USER" }, "dns"),
      },
    },
    include: { zone: { include: { domain: true } } },
  });

  const domainName = record.zone.domain.name;
  const safe = assertSafeDnsRecord(input);
  const name = normalizeRecordName(safe.name, domainName);

  if (safe.type === "MX" && safe.priority === undefined) {
    throw new Error("MX records require a priority");
  }

  const duplicate = await prisma.dnsRecord.findFirst({
    where: {
      zoneId: record.zoneId,
      name,
      type: safe.type,
      value: safe.value,
      NOT: { id: recordId },
    },
  });
  if (duplicate) {
    throw new Error("A record with these details already exists");
  }

  await prisma.dnsRecord.update({
    where: { id: recordId },
    data: {
      name,
      type: safe.type,
      value: safe.value,
      ttl: safe.ttl ?? record.ttl,
      priority: safe.type === "MX" ? (safe.priority ?? 10) : null,
    },
  });

  return syncDnsZone(record.zone.domain.id, userId);
}

export async function deleteDnsRecord(recordId: string, userId: string) {
  const record = await prisma.dnsRecord.findFirstOrThrow({
    where: {
      id: recordId,
      zone: {
        domain: domainAccessWhere({ id: userId, role: "USER" }, "dns"),
      },
    },
    include: { zone: { include: { domain: true } } },
  });

  await prisma.dnsRecord.delete({ where: { id: record.id } });

  return syncDnsZone(record.zone.domain.id, userId);
}

export async function removeSubdomainDnsRecord(domainId: string, subdomainName: string) {
  const domain = await loadDomainWithZone(domainId);
  if (!domain.dnsZone) return;

  const name = normalizeRecordName(subdomainName, domain.name);

  await prisma.dnsRecord.deleteMany({
    where: {
      zoneId: domain.dnsZone.id,
      type: "A",
      OR: [
        { name },
        { name: subdomainName },
        { name: `${name}.${domain.name}` },
      ],
    },
  });

  return syncDnsZone(domainId);
}

export async function deleteDnsZoneForDomain(domainName: string, serverId: string) {
  await callAgent(
    { action: "delete_dns_zone", domain: domainName },
    await agentTargetForServerId(serverId)
  );
}

export async function retryDnsZone(domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: {
      id: domainId,
      ...domainAccessWhere({ id: userId, role: "USER" }, "dns"),
    },
  });
  return syncDnsZone(domain.id, userId);
}

export function getDnsNameservers() {
  return { ns1: getDnsNs1(), ns2: getDnsNs2() };
}

export function getMailDnsInfo(domainName: string, ipAddress: string) {
  const mailHost = getMailHostname(domainName);
  return {
    mailHost,
    records: mailDnsRecords(domainName, ipAddress, mailHost),
  };
}
