/** Allowlisted /execute actions. Unknown names never reach handlers. */
export const AGENT_ACTIONS = [
  "ping",
  "list_plugins",
  "plugin_invoke",
  "runtime_versions",
  "create_domain",
  "delete_domain",
  "create_subdomain",
  "delete_subdomain",
  "ensure_mail_proxy",
  "issue_ssl",
  "renew_ssl",
  "ssl_cert_info",
  "create_mail_account",
  "delete_mail_account",
  "reset_mail_password",
  "set_mail_account_active",
  "create_ftp_account",
  "delete_ftp_account",
  "export_postgres_database",
  "import_postgres_database",
  "reassign_postgres_ownership",
  "postgres_database_exists",
  "create_postgres_database",
  "delete_postgres_database",
  "reset_postgres_password",
  "inspect_postgres_schema",
  "preview_postgres_table",
  "inspect_hosted_database",
  "preview_hosted_table",
  "query_hosted_sql",
  "create_postgres_table",
  "delete_postgres_table",
  "alter_postgres_table",
  "mutate_postgres_table_rows",
  "query_postgres_sql",
  "sync_dns_zone",
  "delete_dns_zone",
  "list_files",
  "read_file",
  "write_file",
  "delete_file",
  "create_directory",
  "delete_directory",
  "rename_path",
  "move_path",
  "copy_path",
  "upload_file",
  "extract_zip",
  "read_file_binary",
  "block_ip",
  "unblock_ip",
  "configure_site_app",
  "app_start",
  "app_stop",
  "app_restart",
  "refresh_websocket_proxies",
  "app_status",
  "app_remove",
  "app_logs",
  "run_backup",
  "run_domain_backup",
  "restore_backup",
  "restore_domain_backup",
  "delete_backup",
  "configure_backup_timer",
  "set_nginx_upload_limit",
  "docker_ps",
  "docker_control",
  "docker_logs",
  "docker_compose_up",
  "git_deploy",
  "sync_cron_jobs",
] as const;

export type AgentActionName = (typeof AGENT_ACTIONS)[number];

const ACTION_SET = new Set<string>(AGENT_ACTIONS);

export function assertKnownAction(raw: unknown): AgentActionName {
  const action = String(raw ?? "").trim();
  if (!ACTION_SET.has(action)) {
    throw new Error(`Unknown action: ${action || "(empty)"}`);
  }
  return action as AgentActionName;
}

export function assertPluginId(raw: unknown): string {
  const id = String(raw ?? "").trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
    throw new Error("Invalid plugin id");
  }
  return id;
}

export function redactAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/password|secret|token|content|sql|key|authorization/i.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof value === "string" && value.length > 200) {
      out[key] = `${value.slice(0, 80)}…`;
    } else {
      out[key] = value;
    }
  }
  return out;
}
