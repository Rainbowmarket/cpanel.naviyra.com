export type PluginKind = "database" | "runtime" | "service" | "backup";

export type PluginOp =
  | "install"
  | "configure"
  | "health"
  | "create"
  | "delete"
  | "backup"
  | "restore"
  | "inspect"
  | "preview"
  | "query";

export type PluginCapability = {
  op: PluginOp;
  label: string;
};

export type PluginManifest = {
  id: string;
  name: string;
  kind: PluginKind;
  description: string;
  capabilities: PluginCapability[];
  installed?: boolean;
  health?: string;
};

export type PluginContext = {
  dryRun: boolean;
};

export type PluginResult = {
  ok: boolean;
  installed?: boolean;
  detail?: string;
  data?: unknown;
};

export type PluginHandler = (
  op: PluginOp,
  params: Record<string, unknown>,
  ctx: PluginContext
) => Promise<PluginResult>;

export type AgentPlugin = PluginManifest & {
  handler: PluginHandler;
};
