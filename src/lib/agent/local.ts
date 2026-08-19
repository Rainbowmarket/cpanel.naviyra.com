import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentAction, AgentResponse } from "./client";
import { applyDnsZoneLocal, removeDnsZoneLocal } from "@/lib/dns/apply";
import {
  assertSafeDocumentRoot,
  assertPathUnderTenantRoot,
  sanitizeHostnameForPath,
} from "@/lib/hostname";

const CONFIG_ROOT = path.join(process.cwd(), "data", "agent-config");

export function isAgentUnreachable(error?: string): boolean {
  if (!error) return false;
  const msg = error.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("agent unreachable") ||
    msg.includes("socket") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("und_err")
  );
}

function findTsxCli(): string | null {
  const root = process.cwd();
  const candidates = [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "node_modules", "tsx", "dist", "cli.cjs"),
    path.join(root, "agent", "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function runPostgresOneShot<T>(payload: AgentAction): Promise<AgentResponse<T>> {
  const script = path.join(process.cwd(), "agent", "exec-action.ts");
  const tsx = findTsxCli();
  if (!existsSync(script) || !tsx) {
    return Promise.resolve({
      success: false,
      error:
        "PostgreSQL helper is missing. Upgrade the panel, then: sudo systemctl restart naviyra-panel",
    });
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, script], {
      cwd: path.join(process.cwd(), "agent"),
      env: { ...process.env, AGENT_DRY_RUN: process.env.AGENT_DRY_RUN || "false" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ success: false, error: "PostgreSQL action timed out" });
    }, 300000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout) as AgentResponse<T>;
        if (parsed && typeof parsed.success === "boolean") {
          resolve(parsed);
          return;
        }
      } catch {
        /* not JSON */
      }
      const detail = (stderr || stdout || "PostgreSQL action failed").trim();
      resolve({ success: false, error: detail.slice(0, 500) });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/** Run hosting actions locally when the agent process is not running (same machine). */
export async function executeLocalAgent<T = unknown>(
  payload: AgentAction
): Promise<AgentResponse<T>> {
  try {
    await fs.mkdir(CONFIG_ROOT, { recursive: true });

    switch (payload.action) {
      case "ping":
        return {
          success: true,
          data: { mode: "local-fallback", platform: process.platform } as T,
        };

      case "create_domain": {
        const domain = sanitizeHostnameForPath(payload.domain);
        const documentRoot = assertSafeDocumentRoot(payload.documentRoot);
        await fs.mkdir(documentRoot, { recursive: true });
        await fs.writeFile(
          path.join(CONFIG_ROOT, `${domain}.conf`),
          `# local vhost\n# ${domain}\n# ${documentRoot}\n`,
          "utf8"
        );
        return {
          success: true,
          data: { domain, documentRoot } as T,
        };
      }

      case "delete_domain": {
        const domain = sanitizeHostnameForPath(payload.domain);
        await fs.rm(path.join(CONFIG_ROOT, `${domain}.conf`), {
          force: true,
        });
        return { success: true };
      }

      case "create_subdomain": {
        const documentRoot = assertSafeDocumentRoot(payload.documentRoot);
        await fs.mkdir(documentRoot, { recursive: true });
        return { success: true, data: { documentRoot } as T };
      }

    case "delete_subdomain": {
      if (payload.deleteFiles && payload.documentRoot) {
        await fs.rm(assertSafeDocumentRoot(String(payload.documentRoot)), {
          recursive: true,
          force: true,
        });
      }
      return { success: true };
    }

      case "issue_ssl":
      case "renew_ssl": {
        const now = new Date();
        const expires = new Date(now);
        expires.setDate(expires.getDate() + 90);
        await fs.writeFile(
          path.join(CONFIG_ROOT, `ssl-${payload.domain}.txt`),
          `issued ${now.toISOString()}`,
          "utf8"
        );
        return {
          success: true,
          data: {
            issuedAt: now.toISOString(),
            expiresAt: expires.toISOString(),
          } as T,
        };
      }

      case "create_mail_account":
        await fs.appendFile(
          path.join(CONFIG_ROOT, "mail.map"),
          `mailbox ${payload.email}\n`,
          "utf8"
        );
        return { success: true, data: { email: payload.email } as T };

      case "delete_mail_account":
        return { success: true };

      case "reset_mail_password":
        await fs.appendFile(
          path.join(CONFIG_ROOT, "mail.map"),
          `reset-password ${payload.email}\n`,
          "utf8"
        );
        return { success: true, data: { email: payload.email } as T };

      case "set_mail_account_active":
        await fs.appendFile(
          path.join(CONFIG_ROOT, "mail.map"),
          `${payload.isActive ? "enable" : "disable"} ${payload.email}\n`,
          "utf8"
        );
        return {
          success: true,
          data: { email: payload.email, isActive: payload.isActive } as T,
        };

      case "create_ftp_account":
        await fs.appendFile(
          path.join(CONFIG_ROOT, "ftp.map"),
          `ftp ${payload.username}:${payload.homeDir}\n`,
          "utf8"
        );
        return {
          success: true,
          data: {
            username: payload.username,
            homeDir: payload.homeDir,
            dryRun: true,
          } as T,
        };

      case "delete_ftp_account":
        await fs.appendFile(
          path.join(CONFIG_ROOT, "ftp.map"),
          `delete ${payload.username}:-\n`,
          "utf8"
        );
        return { success: true, data: { username: payload.username } as T };

      case "sync_dns_zone": {
        const dryRun =
          process.env.AGENT_DRY_RUN === "true" ||
          (process.env.AGENT_DRY_RUN !== "false" && process.platform === "win32");
        const result = await applyDnsZoneLocal(payload, dryRun);
        return { success: true, data: result as T };
      }

      case "delete_dns_zone": {
        const dryRun =
          process.env.AGENT_DRY_RUN === "true" ||
          (process.env.AGENT_DRY_RUN !== "false" && process.platform === "win32");
        await removeDnsZoneLocal(payload.domain, dryRun);
        return { success: true };
      }

      case "list_files": {
        const dirPath = await assertPathUnderTenantRoot(payload.path, payload.root);
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
        return { success: true, data: { entries: data } as T };
      }

      case "read_file": {
        const filePath = await assertPathUnderTenantRoot(payload.path, payload.root);
        const content = await fs.readFile(filePath, "utf8");
        return { success: true, data: { content } as T };
      }

      case "write_file": {
        const filePath = await assertPathUnderTenantRoot(payload.path, payload.root);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, payload.content, "utf8");
        return { success: true };
      }

      case "delete_file": {
        const filePath = await assertPathUnderTenantRoot(payload.path, payload.root);
        await fs.unlink(filePath);
        return { success: true };
      }

      case "create_directory": {
        const dirPath = await assertPathUnderTenantRoot(payload.path, payload.root);
        await fs.mkdir(dirPath, { recursive: true });
        return { success: true };
      }

      case "delete_directory": {
        const dirPath = await assertPathUnderTenantRoot(payload.path, payload.root);
        await fs.rm(dirPath, { recursive: true, force: true });
        return { success: true };
      }

      case "rename_path": {
        const source = await assertPathUnderTenantRoot(payload.source, payload.root);
        const dest = await assertPathUnderTenantRoot(payload.dest, payload.root);
        await fs.rename(source, dest);
        return { success: true };
      }

      case "move_path": {
        const source = await assertPathUnderTenantRoot(payload.source, payload.root);
        const destDir = await assertPathUnderTenantRoot(payload.dest, payload.root);
        const target = await assertPathUnderTenantRoot(
          path.join(destDir, path.basename(source)),
          payload.root
        );
        await fs.rename(source, target);
        return { success: true };
      }

      case "copy_path": {
        const source = await assertPathUnderTenantRoot(payload.source, payload.root);
        const destDir = await assertPathUnderTenantRoot(payload.dest, payload.root);
        const target = await assertPathUnderTenantRoot(
          path.join(destDir, path.basename(source)),
          payload.root
        );
        await fs.cp(source, target, { recursive: true });
        return { success: true };
      }

      case "upload_file": {
        const filePath = await assertPathUnderTenantRoot(payload.path, payload.root);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, Buffer.from(payload.contentBase64, "base64"));
        if (/\.zip$/i.test(filePath)) {
          const { extractZipArchive } = await import("../../../agent/zip");
          const destDir = path.dirname(filePath);
          const result = await extractZipArchive(filePath, destDir, {
            removeZip: payload.removeZip !== false,
          });
          return {
            success: true,
            data: {
              path: filePath,
              extracted: true,
              extractedTo: result.extractedTo,
              removedZip: result.removedZip,
            } as T,
          };
        }
        return { success: true, data: { path: filePath } as T };
      }

      case "extract_zip": {
        const { extractZipArchive } = await import("../../../agent/zip");
        const filePath = await assertPathUnderTenantRoot(payload.path, payload.root);
        const destDir = await assertPathUnderTenantRoot(
          payload.dest || path.dirname(filePath),
          payload.root
        );
        const result = await extractZipArchive(filePath, destDir, {
          removeZip: payload.removeZip === true,
        });
        return {
          success: true,
          data: {
            path: filePath,
            extractedTo: result.extractedTo,
            removedZip: result.removedZip,
          } as T,
        };
      }

      case "read_file_binary": {
        const filePath = await assertPathUnderTenantRoot(payload.path, payload.root);
        const buf = await fs.readFile(filePath);
        return {
          success: true,
          data: {
            contentBase64: buf.toString("base64"),
            size: buf.length,
          } as T,
        };
      }

      case "block_ip":
      case "unblock_ip":
        return { success: true, data: { ip: payload.ip, mode: "local-dry-run" } as T };

      case "run_backup": {
        const root = path.join(process.cwd(), "data", "backups");
        await fs.mkdir(root, { recursive: true });
        const name = `naviyra-backup-local-${Date.now()}.tar.gz`;
        const archivePath = path.join(root, name);
        // Local fallback: copy DB only
        const dbRel = (process.env.DATABASE_URL || "file:./data/naviyra.db").replace(
          /^file:/,
          ""
        );
        const dbPath = path.isAbsolute(dbRel)
          ? dbRel
          : path.join(/* turbopackIgnore: true */ process.cwd(), dbRel);
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const exec = promisify(execFile);
          const work = path.join(root, `.work-${Date.now()}`);
          await fs.mkdir(work, { recursive: true });
          if (payload.includePanelDb !== false) {
            await fs.copyFile(dbPath, path.join(work, path.basename(dbPath)));
          }
          await exec("tar", ["-czf", archivePath, "-C", work, "."]).catch(
            async () => {
              // Windows without tar: write a marker file
              await fs.writeFile(archivePath.replace(/\.tar\.gz$/, ".txt"), "local backup placeholder", "utf8");
            }
          );
          await fs.rm(work, { recursive: true, force: true });
        } catch {
          await fs.writeFile(
            archivePath.replace(/\.tar\.gz$/, ".txt"),
            "local backup placeholder",
            "utf8"
          );
        }
        let sizeBytes = 0;
        try {
          sizeBytes = (await fs.stat(archivePath)).size;
        } catch {
          /* ignore */
        }
        return {
          success: true,
          data: {
            archivePath,
            sizeBytes,
            included: ["panel-db"],
            pruned: [],
          } as T,
        };
      }

      case "configure_backup_timer":
        return {
          success: true,
          data: {
            installed: false,
            onCalendar: "*-*-* 03:00:00",
            mode: "local-fallback",
          } as T,
        };

      case "delete_backup": {
        const archivePath = String(payload.archivePath || "");
        if (!archivePath) {
          return { success: false, error: "archivePath required" };
        }
        const allowed = path.resolve(
          String(payload.allowedRoot || path.join(process.cwd(), "data", "backups"))
        );
        const resolved = path.resolve(archivePath);
        if (
          resolved !== allowed &&
          !resolved.startsWith(allowed + path.sep) &&
          !resolved.startsWith(path.join(process.cwd(), "data", "backups"))
        ) {
          return { success: false, error: "Archive outside allowed backup root" };
        }
        try {
          await fs.rm(resolved, { force: true });
        } catch {
          /* missing is fine */
        }
        return {
          success: true,
          data: { deleted: resolved, missing: false } as T,
        };
      }

      case "run_domain_backup":
        return {
          success: false,
          error:
            "Server agent is not reachable. Domain backup needs the live agent (files, DNS, mail, PostgreSQL).",
        };

      case "create_postgres_database":
      case "delete_postgres_database":
      case "reset_postgres_password":
      case "inspect_postgres_schema":
      case "preview_postgres_table":
      case "create_postgres_table":
      case "delete_postgres_table":
      case "alter_postgres_table":
        return runPostgresOneShot<T>(payload);

      case "restore_backup":
        return {
          success: true,
          data: {
            restored: ["(local-fallback-noop)"],
            panelRestartScheduled: false,
          } as T,
        };

      case "restore_domain_backup":
        return {
          success: true,
          data: {
            restored: ["(local-fallback-noop)"],
            panelRestartScheduled: false,
          } as T,
        };

      default:
        return { success: false, error: `Unknown action: ${payload.action}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Local fallback failed",
    };
  }
}
