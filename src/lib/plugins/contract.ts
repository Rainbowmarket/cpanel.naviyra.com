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

/** Drop a file in agent/plugins/contrib/ — the agent loads it without panel core changes. */
export const CONTRIB_PLUGIN_HINT =
  "Add agent/plugins/contrib/<id>.ts exporting default AgentPlugin. The panel lists whatever the agent reports.";
