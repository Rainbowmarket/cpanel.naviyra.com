import fs from "node:fs/promises";
import path from "node:path";

export type DnsRecordPayload = {
  name: string;
  type: string;
  value: string;
  ttl?: number;
  priority?: number;
};

export type SyncDnsZonePayload = {
  domain: string;
  serial: number;
  ns1: string;
  ns2: string;
  ipAddress: string;
  records: DnsRecordPayload[];
  zoneContent: string;
};

function formatRecordName(name: string, domain: string): string {
  if (name === "@" || name === "" || name === domain) return "@";
  if (name.endsWith(`.${domain}`)) {
    return name.slice(0, -(domain.length + 1));
  }
  return name;
}

function recordLine(
  record: DnsRecordPayload,
  domain: string,
  defaultTtl: number
): string {
  const ttl = record.ttl ?? defaultTtl;
  const name = formatRecordName(record.name, domain);
  const label = name === "@" ? "@" : name;

  if (record.type === "MX") {
    const priority = record.priority ?? 10;
    return `${label.padEnd(8)} ${ttl} IN MX ${priority} ${record.value}`;
  }

  return `${label.padEnd(8)} ${ttl} IN ${record.type} ${record.value}`;
}

export function buildZoneFile(input: {
  domain: string;
  serial: number;
  ns1: string;
  ns2: string;
  records: DnsRecordPayload[];
  defaultTtl?: number;
}): string {
  const ttl = input.defaultTtl ?? 86400;
  const admin = `admin.${input.domain}`;

  const lines = [
    `$TTL ${ttl}`,
    `@       IN  SOA ${input.ns1}. ${admin}. (`,
    `                ${input.serial} ; serial`,
    "                3600       ; refresh",
    "                1800       ; retry",
    "                604800     ; expire",
    "                86400 )    ; minimum",
    "",
    `@       IN  NS  ${input.ns1}.`,
    `@       IN  NS  ${input.ns2}.`,
    "",
  ];

  for (const record of input.records) {
    lines.push(recordLine(record, input.domain, ttl));
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

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function runReload(bindReloadCmd: string | undefined, dryRun: boolean) {
  if (!bindReloadCmd || dryRun) return;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const [cmd, ...args] = bindReloadCmd.split(/\s+/);
  await exec(cmd, args);
}

export async function applyDnsZone(
  dnsRoot: string,
  payload: SyncDnsZonePayload,
  options: {
    dryRun: boolean;
    bindZonesDir?: string;
    bindReloadCmd?: string;
  }
) {
  const zonesDir = path.join(dnsRoot, "zones");
  const namedDir = path.join(dnsRoot, "named");
  await fs.mkdir(zonesDir, { recursive: true });
  await fs.mkdir(namedDir, { recursive: true });

  const zoneFileName = `db.${payload.domain}`;
  const zonePath = path.join(zonesDir, zoneFileName);
  await fs.writeFile(zonePath, payload.zoneContent, "utf8");

  const namedBlockPath = path.join(namedDir, `${payload.domain}.conf`);
  await fs.writeFile(
    namedBlockPath,
    buildNamedZoneBlock(payload.domain, zonePath),
    "utf8"
  );

  const manifestPath = path.join(dnsRoot, "zones.json");
  let manifest: Record<string, { zoneFile: string; namedBlock: string }> = {};
  if (await fileExists(manifestPath)) {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  }
  manifest[payload.domain] = {
    zoneFile: zonePath,
    namedBlock: namedBlockPath,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  let bindPath: string | undefined;
  if (options.bindZonesDir) {
    await fs.mkdir(options.bindZonesDir, { recursive: true });
    bindPath = path.join(options.bindZonesDir, zoneFileName);
    if (!options.dryRun) {
      await fs.copyFile(zonePath, bindPath);
    }
    await runReload(options.bindReloadCmd, options.dryRun);
  }

  return {
    zonePath,
    namedBlockPath,
    bindPath,
    mode: options.bindZonesDir && !options.dryRun ? "bind" : "file",
  };
}

export async function removeDnsZone(
  dnsRoot: string,
  domain: string,
  options: {
    dryRun: boolean;
    bindZonesDir?: string;
    bindReloadCmd?: string;
  }
) {
  const zonesDir = path.join(dnsRoot, "zones");
  const namedDir = path.join(dnsRoot, "named");
  const zoneFileName = `db.${domain}`;

  await fs.rm(path.join(zonesDir, zoneFileName), { force: true });
  await fs.rm(path.join(namedDir, `${domain}.conf`), { force: true });

  const manifestPath = path.join(dnsRoot, "zones.json");
  if (await fileExists(manifestPath)) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    delete manifest[domain];
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  if (options.bindZonesDir) {
    await fs.rm(path.join(options.bindZonesDir, zoneFileName), { force: true });
    await runReload(options.bindReloadCmd, options.dryRun);
  }

  return { ok: true };
}
