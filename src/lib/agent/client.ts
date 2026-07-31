import { executeLocalAgent, isAgentUnreachable } from "./local";
import { requireAgentApiKey } from "@/lib/secrets";

export type AgentAction =
  | { action: "ping" }
  | { action: "create_domain"; domain: string; documentRoot: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "delete_domain"; domain: string }
  | { action: "create_subdomain"; domain: string; subdomain: string; documentRoot: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "delete_subdomain"; domain: string; subdomain: string; documentRoot?: string; deleteFiles?: boolean }
  | { action: "ensure_mail_proxy"; hostname: string }
  | { action: "issue_ssl"; domain: string; subdomains?: string[]; documentRoot?: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "renew_ssl"; domain: string; documentRoot?: string; phpEnabled?: boolean; appType?: string; upstreamPort?: number | null }
  | { action: "create_mail_account"; email: string; password: string; quotaMb?: number }
  | { action: "delete_mail_account"; email: string }
  | { action: "reset_mail_password"; email: string; password: string }
  | { action: "set_mail_account_active"; email: string; isActive: boolean }
  | { action: "create_mail_alias"; alias: string; forwardTo: string }
  | { action: "create_ftp_account"; username: string; password: string; homeDir: string }
  | { action: "delete_ftp_account"; username: string }
  | { action: "list_files"; path: string }
  | { action: "read_file"; path: string }
  | { action: "write_file"; path: string; content: string }
  | { action: "delete_file"; path: string }
  | { action: "create_directory"; path: string }
  | { action: "delete_directory"; path: string }
  | { action: "rename_path"; source: string; dest: string }
  | { action: "move_path"; source: string; dest: string }
  | { action: "copy_path"; source: string; dest: string }
  | { action: "upload_file"; path: string; contentBase64: string; removeZip?: boolean }
  | { action: "extract_zip"; path: string; dest?: string; removeZip?: boolean }
  | { action: "read_file_binary"; path: string }
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
  | {
      action: "run_backup";
      backupRoot: string;
      retainCount: number;
      includePanelDb: boolean;
      includeSites: boolean;
      includeDns: boolean;
      includeMail: boolean;
    }
  | {
      action: "run_domain_backup";
      domain: string;
      backupRoot: string;
      retainCount: number;
      includeSites: boolean;
      includeDns: boolean;
      includeMail: boolean;
    }
  | {
      action: "restore_backup";
      archivePath: string;
      allowedRoot?: string;
      restorePanelDb?: boolean;
      restoreSites?: boolean;
      restoreDns?: boolean;
      restoreMail?: boolean;
    }
  | {
      action: "restore_domain_backup";
      archivePath: string;
      allowedRoot?: string;
      domain?: string;
      restoreSites?: boolean;
      restoreDns?: boolean;
      restoreMail?: boolean;
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
    };

export type AgentResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  via?: "agent" | "local";
};

// Use 127.0.0.1 — avoids Windows localhost/IPv6 connection issues
const AGENT_URL = process.env.AGENT_URL ?? "http://127.0.0.1:4000";

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

async function callAgentRemote<T = unknown>(
  payload: AgentAction,
  serverAgentKey?: string
): Promise<AgentResponse<T>> {
  const longRunning =
    payload.action === "upload_file" ||
    payload.action === "extract_zip" ||
    payload.action === "run_backup" ||
    payload.action === "run_domain_backup" ||
    payload.action === "restore_backup" ||
    payload.action === "restore_domain_backup";
  try {
    const response = await fetch(`${AGENT_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey(serverAgentKey)}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(
        payload.action === "run_backup" ||
          payload.action === "run_domain_backup" ||
          payload.action === "restore_backup" ||
          payload.action === "restore_domain_backup"
          ? 600000
          : longRunning
            ? 120000
            : 10000
      ),
    });

    if (!response.ok) {
      const text = await response.text();
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

export async function callAgent<T = unknown>(
  payload: AgentAction,
  serverAgentKey?: string
): Promise<AgentResponse<T>> {
  const remote = await callAgentRemote<T>(payload, serverAgentKey);

  if (remote.success) return remote;

  // Agent not running — use built-in local handler (same machine)
  if (isAgentUnreachable(remote.error)) {
    const local = await executeLocalAgent<T>(payload);
    return { ...local, via: "local" };
  }

  return remote;
}

export async function pingAgent(): Promise<boolean> {
  const result = await callAgent({ action: "ping" });
  return result.success;
}

export function getAgentMode(): "agent" | "local" | "offline" {
  return "agent"; // resolved at runtime via ping in status API
}
