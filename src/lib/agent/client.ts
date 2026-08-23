import { requireAgentApiKey } from "@/lib/secrets";
import type { AgentTarget } from "./target";
import { notifyIfAgentUnreachable } from "@/lib/mail/admin-alerts";
import { executeLocalAgent, isAgentUnreachable } from "./local";

export type { AgentTarget } from "./target";

export type AgentAction =
  | { action: "ping" }
  | { action: "runtime_versions" }
  | { action: "create_domain"; domain: string; documentRoot: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "delete_domain"; domain: string }
  | { action: "create_subdomain"; domain: string; subdomain: string; documentRoot: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "delete_subdomain"; domain: string; subdomain: string; documentRoot?: string; deleteFiles?: boolean }
  | { action: "ensure_mail_proxy"; hostname: string }
  | { action: "issue_ssl"; domain: string; subdomains?: string[]; documentRoot?: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "renew_ssl"; domain: string; documentRoot?: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "ssl_cert_info"; domain: string }
  | { action: "create_mail_account"; email: string; password: string; quotaMb?: number }
  | { action: "delete_mail_account"; email: string }
  | { action: "reset_mail_password"; email: string; password: string }
  | { action: "set_mail_account_active"; email: string; isActive: boolean }
  | { action: "create_mail_alias"; alias: string; forwardTo: string }
  | { action: "create_ftp_account"; username: string; password: string; homeDir: string }
  | { action: "delete_ftp_account"; username: string }
  | {
      action: "create_postgres_database";
      dbName: string;
      roleName: string;
      password: string;
    }
  | { action: "postgres_database_exists"; dbName: string }
  | {
      action: "export_postgres_database";
      dbName: string;
      format?: "sql" | "custom";
    }
  | {
      action: "import_postgres_database";
      dbName: string;
      roleName?: string;
      format?: "sql" | "custom";
      fileName?: string;
      contentBase64: string;
    }
  | { action: "reassign_postgres_ownership"; dbName: string; roleName: string }
  | { action: "delete_postgres_database"; dbName: string; roleName: string }
  | { action: "reset_postgres_password"; roleName: string; password: string }
  | { action: "inspect_postgres_schema"; dbName: string }
  | {
      action: "inspect_hosted_database";
      engine: string;
      dbName: string;
    }
  | {
      action: "preview_hosted_table";
      engine: string;
      dbName: string;
      table: string;
      limit?: number;
    }
  | {
      action: "preview_postgres_table";
      dbName: string;
      schema?: string;
      table: string;
      limit?: number;
      search?: string;
      filterColumn?: string;
      filterOp?: "contains" | "equals";
      filterValue?: string;
    }
  | {
      action: "create_postgres_table";
      dbName: string;
      roleName: string;
      schema?: string;
      table: string;
      columns: Array<{
        name: string;
        type: string;
        nullable?: boolean;
        primaryKey?: boolean;
        defaultValue?: string | null;
      }>;
    }
  | {
      action: "delete_postgres_table";
      dbName: string;
      schema?: string;
      table: string;
    }
  | {
      action: "alter_postgres_table";
      dbName: string;
      roleName: string;
      schema?: string;
      table: string;
      newName?: string;
      addColumns?: Array<{
        name: string;
        type: string;
        nullable?: boolean;
        primaryKey?: boolean;
        defaultValue?: string | null;
      }>;
      dropColumns?: string[];
    }
  | {
      action: "mutate_postgres_table_rows";
      dbName: string;
      schema?: string;
      table: string;
      op: "insert" | "update" | "delete";
      values?: Record<string, unknown>;
      where?: Record<string, unknown>;
      whereList?: Record<string, unknown>[];
    }
  | { action: "query_postgres_sql"; dbName: string; sql: string }
  | { action: "query_hosted_sql"; engine: string; dbName: string; sql: string }
  | { action: "list_files"; path: string; root?: string }
  | { action: "read_file"; path: string; root?: string }
  | { action: "write_file"; path: string; content: string; root?: string }
  | { action: "delete_file"; path: string; root?: string }
  | { action: "create_directory"; path: string; root?: string }
  | { action: "delete_directory"; path: string; root?: string }
  | { action: "rename_path"; source: string; dest: string; root?: string }
  | { action: "move_path"; source: string; dest: string; root?: string }
  | { action: "copy_path"; source: string; dest: string; root?: string }
  | {
      action: "upload_file";
      path: string;
      contentBase64: string;
      removeZip?: boolean;
      root?: string;
    }
  | {
      action: "extract_zip";
      path: string;
      dest?: string;
      removeZip?: boolean;
      root?: string;
    }
  | { action: "read_file_binary"; path: string; root?: string }
  | {
      action: "sync_dns_zone";
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
    }
  | { action: "delete_dns_zone"; domain: string }
  | { action: "block_ip"; ip: string; reason?: string }
  | { action: "unblock_ip"; ip: string }
  | {
      action: "configure_site_app";
      siteId: string;
      siteName: string;
      documentRoot: string;
      appType: string;
      startCommand?: string;
      appWorkingDir?: string;
      appEnv?: string | null;
      upstreamPort?: number | null;
      isSubdomain?: boolean;
    }
  | { action: "app_start"; siteId: string }
  | { action: "app_stop"; siteId: string }
  | { action: "app_restart"; siteId: string }
  | { action: "app_status"; siteId: string }
  | { action: "app_remove"; siteId: string }
  | { action: "app_logs"; siteId: string; lines?: number }
  | { action: "refresh_websocket_proxies" }
  | {
      action: "run_backup";
      backupRoot: string;
      retainCount: number;
      includePanelDb: boolean;
      includeSites: boolean;
      includeDns: boolean;
      includeMail: boolean;
      includeDatabases?: boolean;
      databases?: Array<{ domain?: string; dbName: string; roleName: string }>;
    }
  | {
      action: "run_domain_backup";
      domain: string;
      backupRoot: string;
      retainCount: number;
      includeSites: boolean;
      includeDns: boolean;
      includeMail: boolean;
      includeDatabases?: boolean;
      databases?: Array<{ domain?: string; dbName: string; roleName: string }>;
    }
  | {
      action: "restore_backup";
      archivePath: string;
      allowedRoot?: string;
      restorePanelDb?: boolean;
      restoreSites?: boolean;
      restoreDns?: boolean;
      restoreMail?: boolean;
      restoreDatabases?: boolean;
    }
  | {
      action: "restore_domain_backup";
      archivePath: string;
      allowedRoot?: string;
      domain?: string;
      restoreSites?: boolean;
      restoreDns?: boolean;
      restoreMail?: boolean;
      restoreDatabases?: boolean;
    }
  | {
      action: "delete_backup";
      archivePath: string;
      allowedRoot?: string;
    }
  | {
      action: "configure_backup_timer";
      enabled: boolean;
      schedule: string;
      panelPort?: number;
      workerToken?: string;
    }
      | { action: "set_nginx_upload_limit"; maxMb: number }
  | { action: "docker_ps" }
  | {
      action: "docker_control";
      id: string;
      op: "start" | "stop" | "restart";
    }
  | { action: "docker_logs"; id: string; lines?: number }
  | {
      action: "docker_compose_up";
      composePath: string;
      documentRoot: string;
    }
  | {
      action: "git_deploy";
      documentRoot: string;
      repoUrl: string;
      branch?: string;
    }
      | {
      action: "sync_cron_jobs";
      jobs: Array<{
        id: string;
        schedule: string;
        command: string;
        enabled?: boolean;
      }>;
    }
  | { action: "list_host_services" }
  | {
      action: "control_host_service";
      id: string;
      op: "start" | "stop" | "restart";
    }
  | { action: "install_host_service"; id: string }
  | { action: "list_plugins" }
  | {
      action: "plugin_invoke";
      pluginId: string;
      op: "install" | "configure" | "health" | "create" | "delete" | "backup" | "restore" | "inspect" | "preview" | "query";
      params?: Record<string, unknown>;
    };

export type AgentResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  via?: "agent" | "local";
};

function agentAuthHeader(agentKey: string) {
  return `Bearer ${agentKey.trim() || requireAgentApiKey()}`;
}

function unreachableMessage(agentUrl: string, error: string) {
  const msg = error.trim() || "Agent unreachable";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|timed out|unreachable/i.test(msg)) {
    return `Could not reach agent at ${agentUrl}`;
  }
  return msg;
}

function failUnreachable<T = unknown>(
  agentUrl: string,
  extra: string
): AgentResponse<T> {
  const error = unreachableMessage(agentUrl, extra);
  notifyIfAgentUnreachable(error);
  return { success: false, error };
}

function agentActionTimeoutMs(
  action: string,
  postgresAction: boolean,
  longRunning: boolean
): number {
  if (action === "plugin_invoke" || action === "install_host_service") return 900000;
  if (action === "issue_ssl" || action === "renew_ssl") return 180000;
  if (action === "ssl_cert_info" || action === "ensure_mail_proxy") return 60000;
  if (action === "list_plugins") return 120000;
  if (
    action === "inspect_hosted_database" ||
    action === "preview_hosted_table" ||
    action === "query_hosted_sql"
  ) {
    return 120000;
  }
  if (
    action === "configure_site_app" ||
    action === "app_start" ||
    action === "app_restart"
  ) {
    return 360000;
  }
  if (
    action === "run_backup" ||
    action === "run_domain_backup" ||
    action === "restore_backup" ||
    action === "restore_domain_backup" ||
    action === "export_postgres_database" ||
    action === "import_postgres_database" ||
    action === "git_deploy" ||
    action === "docker_compose_up"
  ) {
    return 600000;
  }
  if (action.startsWith("docker_")) return 90000;
  if (postgresAction) return 300000;
  if (longRunning) return 120000;
  return 10000;
}

function isLoopbackAgentUrl(agentUrl: string): boolean {
  try {
    const host = new URL(agentUrl).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

async function callAgentAt<T = unknown>(
  agentUrl: string,
  payload: AgentAction,
  agentKey: string
): Promise<AgentResponse<T>> {
  const postgresAction = payload.action.includes("postgres");
  const longRunning =
    payload.action === "upload_file" ||
    payload.action === "extract_zip" ||
    payload.action === "run_backup" ||
    payload.action === "run_domain_backup" ||
    payload.action === "restore_backup" ||
    payload.action === "restore_domain_backup" ||
    postgresAction;
  try {
    const response = await fetch(`${agentUrl}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: agentAuthHeader(agentKey),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(agentActionTimeoutMs(payload.action, postgresAction, longRunning)),
    });

    if (!response.ok) {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed.error === "string" && parsed.error.trim()) {
          return { success: false, error: parsed.error };
        }
      } catch {
        /* not JSON */
      }
      return { success: false, error: text || `Agent HTTP ${response.status}` };
    }

    const result = (await response.json()) as AgentResponse<T>;
    return { ...result, via: "agent" };
  } catch (error) {
    return {
      success: false,
      error: unreachableMessage(
        agentUrl,
        error instanceof Error ? error.message : "Agent unreachable"
      ),
    };
  }
}

export async function callAgent<T = unknown>(
  payload: AgentAction,
  target: AgentTarget
): Promise<AgentResponse<T>> {
  const url = target.agentUrl.trim().replace(/\/$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { success: false, error: "Agent URL must be http or https" };
  }
  if (!target.agentKey.trim()) {
    return { success: false, error: "Agent key is missing" };
  }
  const result = await callAgentAt<T>(url, payload, target.agentKey);
  if (
    !result.success &&
    process.platform === "linux" &&
    isLoopbackAgentUrl(url) &&
    isAgentUnreachable(result.error) &&
    (payload.action === "issue_ssl" ||
      payload.action === "renew_ssl" ||
      payload.action === "ssl_cert_info" ||
      payload.action === "ensure_mail_proxy")
  ) {
    const local = await executeLocalAgent<T>(payload);
    if (local.success) return { ...local, via: "local" };
    notifyIfAgentUnreachable(result.error);
    return {
      success: false,
      error: local.error || result.error,
      via: "local",
    };
  }
  if (!result.success) notifyIfAgentUnreachable(result.error);
  return result;
}

/** @deprecated Use callAgent(payload, target) */
export async function callRemoteServerAgent<T = unknown>(
  opts: AgentTarget,
  payload: AgentAction
): Promise<AgentResponse<T>> {
  return callAgent<T>(payload, opts);
}

export async function uploadFileToAgent(
  filePath: string,
  content: Buffer,
  options: {
    target: AgentTarget;
    removeZip?: boolean;
    root?: string;
  }
): Promise<
  AgentResponse<{
    path: string;
    extracted?: boolean;
    extractedTo?: string;
    removedZip?: boolean;
  }>
> {
  const removeZip = options.removeZip !== false;
  const agentUrl = options.target.agentUrl.trim().replace(/\/$/, "");
  try {
    const response = await fetch(`${agentUrl}/upload-file`, {
      method: "POST",
      headers: {
        Authorization: agentAuthHeader(options.target.agentKey),
        "Content-Type": "application/octet-stream",
        "X-Naviyra-Path": filePath,
        ...(options.root ? { "X-Naviyra-Root": options.root } : {}),
        "X-Naviyra-Remove-Zip": removeZip ? "1" : "0",
      },
      body: new Uint8Array(content),
      cache: "no-store",
      signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) {
      const text = await response.text();
      if (/404|Not found/i.test(text) || response.status === 404) {
        return callAgent(
          {
            action: "upload_file",
            path: filePath,
            contentBase64: content.toString("base64"),
            removeZip,
            root: options.root,
          },
          options.target
        );
      }
      return {
        success: false,
        error: text || `Agent HTTP ${response.status}`,
      };
    }
    const result = (await response.json()) as AgentResponse<{
      path: string;
      extracted?: boolean;
      extractedTo?: string;
      removedZip?: boolean;
    }>;
    return { ...result, via: "agent" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return failUnreachable(agentUrl, msg);
  }
}

export async function downloadBackupFromAgent(opts: {
  target: AgentTarget;
  archivePath: string;
  allowedRoot?: string;
}): Promise<AgentResponse<{ content: Buffer; fileName: string }>> {
  const agentUrl = opts.target.agentUrl.trim().replace(/\/$/, "");
  try {
    const response = await fetch(`${agentUrl}/download-backup`, {
      method: "GET",
      headers: {
        Authorization: agentAuthHeader(opts.target.agentKey),
        "X-Naviyra-Path": opts.archivePath,
        ...(opts.allowedRoot
          ? { "X-Naviyra-Backup-Root": opts.allowedRoot }
          : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: text || `Agent HTTP ${response.status}`,
      };
    }
    const buf = Buffer.from(await response.arrayBuffer());
    const disp = response.headers.get("content-disposition") || "";
    const named = /filename="([^"]+)"/.exec(disp)?.[1];
    return {
      success: true,
      via: "agent",
      data: {
        content: buf,
        fileName: named || opts.archivePath.split(/[/\\]/).pop() || "backup.tar.gz",
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return failUnreachable(agentUrl, msg);
  }
}

export async function uploadBackupToAgent(opts: {
  target: AgentTarget;
  fileName: string;
  content: Buffer;
  allowedRoot?: string;
}): Promise<
  AgentResponse<{ archivePath: string; bytes: number; dryRun?: boolean }>
> {
  const agentUrl = opts.target.agentUrl.trim().replace(/\/$/, "");
  try {
    const response = await fetch(`${agentUrl}/upload-backup`, {
      method: "POST",
      headers: {
        Authorization: agentAuthHeader(opts.target.agentKey),
        "Content-Type": "application/octet-stream",
        "X-Naviyra-Name": opts.fileName,
        ...(opts.allowedRoot
          ? { "X-Naviyra-Backup-Root": opts.allowedRoot }
          : {}),
      },
      body: new Uint8Array(opts.content),
      cache: "no-store",
      signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: text || `Agent HTTP ${response.status}`,
      };
    }
    const result = (await response.json()) as AgentResponse<{
      archivePath: string;
      bytes: number;
      dryRun?: boolean;
    }>;
    if (result.success && result.data?.archivePath) {
      return { ...result, via: "agent" };
    }
    return { success: false, error: result.error || "Upload failed" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return failUnreachable(agentUrl, msg);
  }
}

export async function pingAgent(target: AgentTarget): Promise<boolean> {
  const result = await callAgent({ action: "ping" }, target);
  return result.success;
}

export function getAgentMode(): "agent" | "local" | "offline" {
  return "agent";
}
