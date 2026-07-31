import fs from "node:fs/promises";
import path from "node:path";
import { buildNamedZoneBlock } from "./zone";
import {
  getBindIncludeFile,
  getBindNamedDir,
  getBindReloadCmd,
  getBindZonesDir,
  getDnsRoot,
} from "@/lib/paths";

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

  const normalized = bindReloadCmd.trim().replace(/^["']|["']$/g, "");
  const command =
    !normalized || normalized === "rndc"
      ? "rndc reload"
      : normalized === "systemctl"
        ? "systemctl reload named"
        : normalized;

  const [cmd, ...args] = command.split(/\s+/).filter(Boolean);
  if (!cmd) return;

  try {
    await exec(cmd, args);
  } catch (error) {
    // Fall back if rndc is misconfigured
    if (cmd === "rndc") {
      await exec("systemctl", ["reload", "named"]);
      return;
    }
    throw error;
  }
}

async function refreshBindIncludeFile(
  namedDir: string,
  includeFile: string | undefined,
  dryRun: boolean
) {
  if (!includeFile || dryRun) return;
  const files = (await fs.readdir(namedDir))
    .filter((name) => name.endsWith(".conf"))
    .sort();
  const lines = files.map(
    (name) => `include "${path.join(namedDir, name).replace(/\\/g, "/")}";`
  );
  await fs.writeFile(includeFile, `${lines.join("\n")}\n`, "utf8");
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
  const bindNamedDir = getBindNamedDir();
  let bindPath: string | undefined;
  if (bindZonesDir) {
    await fs.mkdir(bindZonesDir, { recursive: true });
    bindPath = path.join(bindZonesDir, zoneFileName);
    if (!dryRun) {
      await fs.copyFile(zonePath, bindPath);
    }

    if (bindNamedDir) {
      await fs.mkdir(bindNamedDir, { recursive: true });
      const bindNamedPath = path.join(bindNamedDir, `${payload.domain}.conf`);
      if (!dryRun) {
        await fs.writeFile(
          bindNamedPath,
          buildNamedZoneBlock(payload.domain, bindPath),
          "utf8"
        );
        await refreshBindIncludeFile(
          bindNamedDir,
          getBindIncludeFile(),
          dryRun
        );
      }
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
  const bindNamedDir = getBindNamedDir();
  if (bindZonesDir) {
    await fs.rm(path.join(bindZonesDir, zoneFileName), { force: true });
    if (bindNamedDir) {
      await fs.rm(path.join(bindNamedDir, `${domain}.conf`), { force: true });
      await refreshBindIncludeFile(bindNamedDir, getBindIncludeFile(), dryRun);
    }
    await runReload(getBindReloadCmd(), dryRun);
  }

  return { ok: true };
}
