/**
 * Naviyra Server Agent — cross-platform (Windows + Linux)
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  API_KEY,
  CONFIG_ROOT,
  DNS_ROOT,
  getBindReloadCmd,
  getBindZonesDir,
  resolveDocumentRoot,
  resolveSubdomainRoot,
  SITES_ROOT,
} from "./paths";
import { applyDnsZone, removeDnsZone, type SyncDnsZonePayload } from "./dns";

const exec = promisify(execFile);
const PORT = Number(process.env.AGENT_PORT ?? 4000);
const isWindows = process.platform === "win32";
const DRY_RUN =
  process.env.AGENT_DRY_RUN === "true" ||
  (process.env.AGENT_DRY_RUN !== "false" && isWindows);

function hasAdminPermission(): boolean {
  if (isWindows) return false;
  return typeof process.getuid === "function" && process.getuid() === 0;
}

type Action = {
  action: string;
  [key: string]: unknown;
};

function unauthorized(res: http.ServerResponse) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
}

async function ensureConfigDir() {
  await fs.mkdir(CONFIG_ROOT, { recursive: true });
}

async function runCmd(cmd: string, args: string[]): Promise<string> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] ${cmd} ${args.join(" ")}`);
    return "";
  }
  const { stdout } = await exec(cmd, args);
  return stdout;
}

async function writeVhostConfig(domain: string, documentRoot: string) {
  await ensureConfigDir();
  const configPath = path.join(CONFIG_ROOT, `${domain}.conf`);
  const content = `# Naviyra vhost\n# domain: ${domain}\n# root: ${documentRoot}\n`;
  await fs.writeFile(configPath, content, "utf8");

  if (!isWindows && !DRY_RUN) {
    await runCmd("bash", ["-c", `echo 'vhost ${domain}' >> /tmp/naviyra-vhosts.log`]);
  }
}

async function handleAction(payload: Action) {
  switch (payload.action) {
    case "ping":
      return {
        success: true,
        data: {
          version: "0.1.0",
          dryRun: DRY_RUN,
          platform: process.platform,
          isAdmin: hasAdminPermission(),
          sitesRoot: SITES_ROOT,
        },
      };

    case "create_domain": {
      const domain = String(payload.domain);
      const documentRoot = resolveDocumentRoot(
        String(payload.documentRoot),
        domain
      );
      await fs.mkdir(documentRoot, { recursive: true });
      await writeVhostConfig(domain, documentRoot);
      return { success: true, data: { domain, documentRoot } };
    }

    case "delete_domain": {
      const domain = String(payload.domain);
      const configPath = path.join(CONFIG_ROOT, `${domain}.conf`);
      await fs.rm(configPath, { force: true });
      return { success: true };
    }

    case "create_subdomain": {
      const domain = String(payload.domain);
      const subdomain = String(payload.subdomain);
      const documentRoot = resolveSubdomainRoot(
        String(payload.documentRoot),
        domain,
        subdomain
      );
      await fs.mkdir(documentRoot, { recursive: true });
      return { success: true, data: { documentRoot } };
    }

    case "delete_subdomain": {
      if (payload.deleteFiles && payload.documentRoot) {
        await fs.rm(String(payload.documentRoot), { recursive: true, force: true });
      }
      return { success: true };
    }

    case "issue_ssl":
    case "renew_ssl": {
      const domain = String(payload.domain);
      const now = new Date();
      const expires = new Date(now);
      expires.setDate(expires.getDate() + 90);
      await ensureConfigDir();
      await fs.writeFile(
        path.join(CONFIG_ROOT, `ssl-${domain}.txt`),
        `issued ${now.toISOString()}`,
        "utf8"
      );
      return {
        success: true,
        data: { issuedAt: now.toISOString(), expiresAt: expires.toISOString() },
      };
    }

    case "create_mail_account": {
      const email = String(payload.email);
      await ensureConfigDir();
      await fs.appendFile(
        path.join(CONFIG_ROOT, "mail.map"),
        `mailbox ${email}\n`,
        "utf8"
      );
      return { success: true, data: { email } };
    }

    case "delete_mail_account":
      return { success: true };

    case "reset_mail_password": {
      const email = String(payload.email);
      await ensureConfigDir();
      await fs.appendFile(
        path.join(CONFIG_ROOT, "mail.map"),
        `reset-password ${email}\n`,
        "utf8"
      );
      return { success: true, data: { email } };
    }

    case "set_mail_account_active": {
      const email = String(payload.email);
      const isActive = Boolean(payload.isActive);
      await ensureConfigDir();
      await fs.appendFile(
        path.join(CONFIG_ROOT, "mail.map"),
        `${isActive ? "enable" : "disable"} ${email}\n`,
        "utf8"
      );
      return { success: true, data: { email, isActive } };
    }

    case "create_ftp_account": {
      const username = String(payload.username);
      const homeDir = String(payload.homeDir);
      await ensureConfigDir();
      await fs.appendFile(
        path.join(CONFIG_ROOT, "ftp.map"),
        `ftp ${username}:${homeDir}\n`,
        "utf8"
      );
      return { success: true, data: { username, homeDir } };
    }

    case "delete_ftp_account":
      return { success: true };

    case "sync_dns_zone": {
      const data = payload as SyncDnsZonePayload & Action;
      const result = await applyDnsZone(
        DNS_ROOT,
        {
          domain: String(data.domain),
          serial: Number(data.serial),
          ns1: String(data.ns1),
          ns2: String(data.ns2),
          ipAddress: String(data.ipAddress),
          records: Array.isArray(data.records) ? data.records : [],
          zoneContent: String(data.zoneContent),
        },
        {
          dryRun: DRY_RUN,
          bindZonesDir: getBindZonesDir(),
          bindReloadCmd: getBindReloadCmd(),
        }
      );
      return { success: true, data: result };
    }

    case "delete_dns_zone": {
      const domain = String(payload.domain);
      await removeDnsZone(DNS_ROOT, domain, {
        dryRun: DRY_RUN,
        bindZonesDir: getBindZonesDir(),
        bindReloadCmd: getBindReloadCmd(),
      });
      return { success: true };
    }

    case "list_files": {
      const dirPath = String(payload.path);
      await fs.mkdir(dirPath, { recursive: true });
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const data = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          const stat = await fs.stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? "directory" : "file",
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        })
      );
      return { success: true, data: { entries: data } };
    }

    case "read_file": {
      const content = await fs.readFile(String(payload.path), "utf8");
      return { success: true, data: { content } };
    }

    case "write_file": {
      const filePath = String(payload.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, String(payload.content), "utf8");
      return { success: true };
    }

    case "delete_file": {
      await fs.unlink(String(payload.path));
      return { success: true };
    }

    case "create_directory": {
      await fs.mkdir(String(payload.path), { recursive: true });
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown action: ${payload.action}` };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/execute") {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${API_KEY}`) {
      return unauthorized(res);
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const payload = JSON.parse(body) as Action;
      const result = await handleAction(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Agent error",
        })
      );
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, async () => {
  await fs.mkdir(SITES_ROOT, { recursive: true });
  const admin = hasAdminPermission();
  console.log(
    `Naviyra agent listening on :${PORT} (dryRun=${DRY_RUN}, admin=${admin}, sites=${SITES_ROOT})`
  );
  if (!DRY_RUN && !admin && !isWindows) {
    console.warn("WARNING: Live mode needs root. Use: sudo ./start-admin.sh");
  }
});
