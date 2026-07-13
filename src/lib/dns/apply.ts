import fs from "node:fs/promises";
import path from "node:path";
import { buildNamedZoneBlock } from "./zone";
import { getBindReloadCmd, getBindZonesDir, getDnsRoot } from "@/lib/paths";

export type SyncDnsZonePayload = {
  domain: string;
  serial: number;
  ns1: string;
  ns2: string;
  ipAddress: string;
  records: Array<{
    name: string;
    type: string;
    value: string;
    ttl?: number;
    priority?: number;
  }>;
  zoneContent: string;
};

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

export async function applyDnsZoneLocal(
  payload: SyncDnsZonePayload,
  dryRun = false
) {
  const dnsRoot = getDnsRoot();
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
  manifest[payload.domain] = { zoneFile: zonePath, namedBlock: namedBlockPath };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const bindZonesDir = getBindZonesDir();
  let bindPath: string | undefined;
  if (bindZonesDir) {
    await fs.mkdir(bindZonesDir, { recursive: true });
    bindPath = path.join(bindZonesDir, zoneFileName);
    if (!dryRun) {
      await fs.copyFile(zonePath, bindPath);
    }
    await runReload(getBindReloadCmd(), dryRun);
  }

  return {
    zonePath,
    namedBlockPath,
    bindPath,
    mode: bindZonesDir && !dryRun ? "bind" : "file",
  };
}

export async function removeDnsZoneLocal(domain: string, dryRun = false) {
  const dnsRoot = getDnsRoot();
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

  const bindZonesDir = getBindZonesDir();
  if (bindZonesDir) {
    await fs.rm(path.join(bindZonesDir, zoneFileName), { force: true });
    await runReload(getBindReloadCmd(), dryRun);
  }

  return { ok: true };
}
