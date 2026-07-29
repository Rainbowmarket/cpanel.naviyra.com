import { executeLocalAgent, isAgentUnreachable } from "./local";

export type AgentAction =
  | { action: "ping" }
  | { action: "create_domain"; domain: string; documentRoot: string; phpEnabled?: boolean }
  | { action: "delete_domain"; domain: string }
  | { action: "create_subdomain"; domain: string; subdomain: string; documentRoot: string; phpEnabled?: boolean }
  | { action: "delete_subdomain"; domain: string; subdomain: string; documentRoot?: string; deleteFiles?: boolean }
  | { action: "issue_ssl"; domain: string; subdomains?: string[]; documentRoot?: string; phpEnabled?: boolean }
  | { action: "renew_ssl"; domain: string; documentRoot?: string; phpEnabled?: boolean }
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
  | { action: "unblock_ip"; ip: string };

export type AgentResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  via?: "agent" | "local";
};

// Use 127.0.0.1 — avoids Windows localhost/IPv6 connection issues
const AGENT_URL = process.env.AGENT_URL ?? "http://127.0.0.1:4000";

function getApiKey(serverAgentKey?: string): string {
  return serverAgentKey || process.env.AGENT_API_KEY || "naviyra-local-agent-key";
}

async function callAgentRemote<T = unknown>(
  payload: AgentAction,
  serverAgentKey?: string
): Promise<AgentResponse<T>> {
  const longRunning =
    payload.action === "upload_file" || payload.action === "extract_zip";
  try {
    const response = await fetch(`${AGENT_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey(serverAgentKey)}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(longRunning ? 120000 : 10000),
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
