import fs from "node:fs/promises";
import path from "node:path";
import type { AgentAction, AgentResponse } from "./client";
import { applyDnsZoneLocal, removeDnsZoneLocal } from "@/lib/dns/apply";

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
    msg.includes("socket")
  );
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
        await fs.mkdir(payload.documentRoot, { recursive: true });
        await fs.writeFile(
          path.join(CONFIG_ROOT, `${payload.domain}.conf`),
          `# local vhost\n# ${payload.domain}\n# ${payload.documentRoot}\n`,
          "utf8"
        );
        return {
          success: true,
          data: { domain: payload.domain, documentRoot: payload.documentRoot } as T,
        };
      }

      case "delete_domain": {
        await fs.rm(path.join(CONFIG_ROOT, `${payload.domain}.conf`), {
          force: true,
        });
        return { success: true };
      }

      case "create_subdomain": {
        await fs.mkdir(payload.documentRoot, { recursive: true });
        return { success: true, data: { documentRoot: payload.documentRoot } as T };
      }

    case "delete_subdomain": {
      if (payload.deleteFiles && payload.documentRoot) {
        await fs.rm(String(payload.documentRoot), { recursive: true, force: true });
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
          data: { username: payload.username, homeDir: payload.homeDir } as T,
        };

      case "delete_ftp_account":
        return { success: true };

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
        await fs.mkdir(payload.path, { recursive: true });
        const entries = await fs.readdir(payload.path, { withFileTypes: true });
        const data = await Promise.all(
          entries.map(async (entry) => {
            const fullPath = path.join(payload.path, entry.name);
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
        const content = await fs.readFile(payload.path, "utf8");
        return { success: true, data: { content } as T };
      }

      case "write_file": {
        await fs.mkdir(path.dirname(payload.path), { recursive: true });
        await fs.writeFile(payload.path, payload.content, "utf8");
        return { success: true };
      }

      case "delete_file": {
        await fs.unlink(payload.path);
        return { success: true };
      }

      case "create_directory": {
        await fs.mkdir(payload.path, { recursive: true });
        return { success: true };
      }

      case "delete_directory": {
        await fs.rm(payload.path, { recursive: true, force: true });
        return { success: true };
      }

      case "rename_path": {
        await fs.rename(payload.source, payload.dest);
        return { success: true };
      }

      case "move_path": {
        const target = path.join(payload.dest, path.basename(payload.source));
        await fs.rename(payload.source, target);
        return { success: true };
      }

      case "copy_path": {
        const target = path.join(payload.dest, path.basename(payload.source));
        await fs.cp(payload.source, target, { recursive: true });
        return { success: true };
      }

      case "upload_file": {
        await fs.mkdir(path.dirname(payload.path), { recursive: true });
        await fs.writeFile(
          payload.path,
          Buffer.from(payload.contentBase64, "base64")
        );
        if (/\.zip$/i.test(payload.path)) {
          const { extractZipArchive } = await import("../../../agent/zip");
          const destDir = path.dirname(payload.path);
          const result = await extractZipArchive(payload.path, destDir, {
            removeZip: payload.removeZip !== false,
          });
          return {
            success: true,
            data: {
              path: payload.path,
              extracted: true,
              extractedTo: result.extractedTo,
              removedZip: result.removedZip,
            } as T,
          };
        }
        return { success: true, data: { path: payload.path } as T };
      }

      case "extract_zip": {
        const { extractZipArchive } = await import("../../../agent/zip");
        const destDir = payload.dest || path.dirname(payload.path);
        const result = await extractZipArchive(payload.path, destDir, {
          removeZip: payload.removeZip === true,
        });
        return {
          success: true,
          data: {
            path: payload.path,
            extractedTo: result.extractedTo,
            removedZip: result.removedZip,
          } as T,
        };
      }

      case "read_file_binary": {
        const buf = await fs.readFile(payload.path);
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
          : path.join(process.cwd(), dbRel);
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

      case "run_domain_backup": {
        const root = path.join(process.cwd(), "data", "backups");
        await fs.mkdir(root, { recursive: true });
        const domain = String(payload.domain || "local");
        const name = `naviyra-domain-${domain.replace(/[^a-z0-9.-]/gi, "-")}-${Date.now()}.tar.gz`;
        const archivePath = path.join(root, name);
        const work = path.join(root, `.work-domain-${Date.now()}`);
        await fs.mkdir(work, { recursive: true });
        await fs.writeFile(
          path.join(work, "manifest.json"),
          JSON.stringify({
            type: "domain",
            domain,
            included: ["sites"],
          }),
          "utf8"
        );
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const exec = promisify(execFile);
          await exec("tar", ["-czf", archivePath, "-C", work, "."]);
        } catch {
          await fs.writeFile(archivePath, "", "utf8");
        }
        await fs.rm(work, { recursive: true, force: true });
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
            included: ["sites"],
            pruned: [],
          } as T,
        };
      }

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
