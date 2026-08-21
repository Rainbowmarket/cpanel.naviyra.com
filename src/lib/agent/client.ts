import { executeLocalAgent, isAgentUnreachable } from "./local";
import { requireAgentApiKey } from "@/lib/secrets";

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
  | { action: "delete_postgres_database"; dbName: string; roleName: string }
  | { action: "reset_postgres_password"; roleName: string; password: string }
  | { action: "inspect_postgres_schema"; dbName: string }
  | {
      action: "preview_postgres_table";
      dbName: string;
      schema?: string;
      table: string;
      limit?: number;
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
    }
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
  | { action: "set_nginx_upload_limit"; maxMb: number };

export type AgentResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  via?: "agent" | "local";
};

// Use 127.0.0.1 — avoids Windows localhost/IPv6 connection issues
function agentUrls(): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const url = value.trim().replace(/\/$/, "");
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const fromEnv = process.env.AGENT_URL?.trim();
  const port = process.env.AGENT_PORT?.trim();
  if (fromEnv) add(fromEnv);
  if (port) add(`http://127.0.0.1:${port}`);
  add("http://127.0.0.1:4000");
  add("http://127.0.0.1:4100");
  return urls;
}

function getApiKey(serverAgentKey?: string): string {
  // Always use the live process env key. Server.agentKey in SQLite can go
  // stale after AGENT_API_KEY rotation and would 401 the local agent.
  const envKey = requireAgentApiKey();
  const fromServer = serverAgentKey?.trim();
  if (fromServer && fromServer !== envKey) {
    console.warn(
      "[agent] Ignoring stale Server.agentKey; using AGENT_API_KEY from environment"
    );
  }
  return envKey;
}

async function callAgentAt<T = unknown>(
  agentUrl: string,
  payload: AgentAction,
  serverAgentKey?: string
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
        Authorization: `Bearer ${getApiKey(serverAgentKey)}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(
        payload.action === "configure_site_app" ||
          payload.action === "app_start" ||
          payload.action === "app_restart"
          ? 360000
          : payload.action === "run_backup" ||
              payload.action === "run_domain_backup" ||
              payload.action === "restore_backup" ||
              payload.action === "restore_domain_backup" ||
              payload.action === "export_postgres_database" ||
              payload.action === "import_postgres_database"
            ? 600000
            : postgresAction
              ? 300000
              : longRunning
                ? 120000
                : 10000
      ),
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
      error: error instanceof Error ? error.message : "Agent unreachable",
    };
  }
}

async function callAgentRemote<T = unknown>(
  payload: AgentAction,
  serverAgentKey?: string
): Promise<AgentResponse<T>> {
  const urls = agentUrls();
  let last: AgentResponse<T> = { success: false, error: "Agent unreachable" };
  for (const url of urls) {
    const result = await callAgentAt<T>(url, payload, serverAgentKey);
    if (result.success) return result;
    if (!isAgentUnreachable(result.error)) return result;
    last = result;
  }
  return last;
}

export async function callAgent<T = unknown>(
  payload: AgentAction,
  serverAgentKey?: string
): Promise<AgentResponse<T>> {
  const remote = await callAgentRemote<T>(payload, serverAgentKey);

  if (remote.success) return remote;

  const unknownPostgres =
    payload.action.includes("postgres") &&
    (remote.error || "").toLowerCase().includes("unknown action");

  // Agent not running, or an older agent that does not know PostgreSQL yet
  if (isAgentUnreachable(remote.error) || unknownPostgres) {
    const local = await executeLocalAgent<T>(payload);
    return { ...local, via: "local" };
  }

  return remote;
}

/** Upload raw bytes to the agent (no base64). Falls back to upload_file JSON. */
export async function uploadFileToAgent(
  filePath: string,
  content: Buffer,
  options?: { removeZip?: boolean; serverAgentKey?: string; root?: string }
): Promise<
  AgentResponse<{
    path: string;
    extracted?: boolean;
    extractedTo?: string;
    removedZip?: boolean;
  }>
> {
  const removeZip = options?.removeZip !== false;
  let lastUnreachable = false;
  let lastMsg = "Agent unreachable";

  for (const agentUrl of agentUrls()) {
    try {
      const response = await fetch(`${agentUrl}/upload-file`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getApiKey(options?.serverAgentKey)}`,
          "Content-Type": "application/octet-stream",
          "X-Naviyra-Path": filePath,
          ...(options?.root ? { "X-Naviyra-Root": options.root } : {}),
          "X-Naviyra-Remove-Zip": removeZip ? "1" : "0",
        },
        body: new Uint8Array(content),
        cache: "no-store",
        signal: AbortSignal.timeout(600000),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Agent HTTP ${response.status}`);
      }
      const result = (await response.json()) as AgentResponse<{
        path: string;
        extracted?: boolean;
        extractedTo?: string;
        removedZip?: boolean;
      }>;
      if (result.success) return { ...result, via: "agent" };
      throw new Error(result.error || "Upload failed");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      lastMsg = msg;
      if (isAgentUnreachable(msg)) {
        lastUnreachable = true;
        continue;
      }
      if (!/404|Not found/i.test(msg)) {
        return { success: false, error: msg };
      }
      lastUnreachable = true;
    }
  }

  if (!lastUnreachable) {
    return { success: false, error: lastMsg };
  }

  return callAgent(
    {
      action: "upload_file",
      path: filePath,
      contentBase64: content.toString("base64"),
      removeZip,
      root: options?.root,
    },
    options?.serverAgentKey
  );
}

export async function pingAgent(): Promise<boolean> {
  const result = await callAgent({ action: "ping" });
  return result.success;
}

export function getAgentMode(): "agent" | "local" | "offline" {
  return "agent"; // resolved at runtime via ping in status API
}
