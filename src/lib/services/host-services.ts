import { callAgent } from "@/lib/agent/client";
import { controllerAgentTarget } from "@/lib/agent/target";

export type HostServiceOp = "start" | "stop" | "restart";

export type HostServiceStatus = {
  id: string;
  name: string;
  group: string;
  detail: string;
  kind: "service" | "timer";
  unit: string;
  installed: boolean;
  active: boolean;
  enabled: boolean;
  state: string;
  allowStop: boolean;
  dryRun: boolean;
  installable?: boolean;
};

export async function listPanelHostServices(): Promise<{
  services: HostServiceStatus[];
  dryRun: boolean;
}> {
  const res = await callAgent<{ services: HostServiceStatus[]; dryRun: boolean }>(
    { action: "list_host_services" },
    await controllerAgentTarget()
  );
  if (!res.success || !res.data) {
    throw new Error(res.error || "Could not list host services");
  }
  return res.data;
}

export async function controlPanelHostService(
  id: string,
  op: HostServiceOp
): Promise<HostServiceStatus> {
  const res = await callAgent<HostServiceStatus>(
    { action: "control_host_service", id, op },
    await controllerAgentTarget()
  );
  if (!res.success || !res.data) {
    throw new Error(res.error || `Could not ${op} service`);
  }
  return res.data;
}

export async function installPanelHostService(id: string): Promise<HostServiceStatus> {
  const res = await callAgent<HostServiceStatus>(
    { action: "install_host_service", id },
    await controllerAgentTarget()
  );
  if (!res.success || !res.data) {
    throw new Error(res.error || "Could not install service");
  }
  return res.data;
}
