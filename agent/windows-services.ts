import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export type WindowsService = { Name: string; State: string; StartMode: string; ProcessId: number };
export type ServiceOperation = "start" | "stop" | "restart";
type Mapping = { names: string[]; pattern?: RegExp; detail: string };

// Only services associated with the hosting stack are eligible for control.
export const WINDOWS_SERVICES: Record<string, Mapping> = {
  panel: { names: ["NaviyraPanel", "naviyra-panel"], detail: "Registered Naviyra Windows service. Use the launcher for an unregistered panel." },
  agent: { names: ["NaviyraAgent", "naviyra-agent"], detail: "Registered Naviyra agent service. Use the launcher for an unregistered agent." },
  nginx: { names: ["NaviyraNginx", "nginx"], detail: "Nginx registered using a Windows service wrapper. Unregistered nginx.exe processes are not managed here." },
  "php-fpm": { names: ["NaviyraPHP"], detail: "PHP FastCGI registered using a Windows service wrapper; native Windows PHP does not provide PHP-FPM." },
  apache: { names: ["Apache2.4", "Apache24", "Apache2.2"], detail: "Apache HTTP Server registered as a Windows service, including XAMPP installations." },
  mysql: { names: ["MySQL", "MySQL80", "MySQL84", "MySQL90", "mysql"], pattern: /^mysql\d*$/i, detail: "MySQL registered as a Windows service. XAMPP may register MariaDB under the name mysql." },
  mariadb: { names: ["MariaDB"], pattern: /^mariadb(?:[-_]?\d+(?:\.\d+)*)?$/i, detail: "MariaDB registered as a Windows service." },
  postgresql: { names: ["postgresql"], pattern: /^postgresql(?:-x64)?-\d+(?:\.\d+)?$/i, detail: "PostgreSQL registered by the Windows installer or pg_ctl." },
  ftp: { names: ["FileZilla Server", "filezilla-server"], detail: "FileZilla Server Windows service. This controls the service; Linux FTP-account provisioning is separate." },
};

export function selectWindowsService(id: string, services: WindowsService[]): WindowsService | undefined {
  const mapping = WINDOWS_SERVICES[id];
  if (!mapping) return undefined;
  // Never pick an arbitrary database instance when several are installed.
  const matches = services.filter((service) =>
    mapping.names.some((name) => name.toLowerCase() === service.Name.toLowerCase()) ||
    Boolean(mapping.pattern?.test(service.Name))
  );
  if (matches.length > 1) throw new Error(`Multiple Windows services match ${id}. Configure WINDOWS_SERVICE_${id.replace(/-/g, "_").toUpperCase()} with the exact service name.`);
  return matches[0];
}

export function resolveWindowsService(id: string, services: WindowsService[]): WindowsService | undefined {
  if (!WINDOWS_SERVICES[id]) return undefined;
  const override = process.env[`WINDOWS_SERVICE_${id.replace(/-/g, "_").toUpperCase()}`]?.trim();
  if (!override) return selectWindowsService(id, services);
  // Overrides are trusted host configuration, never supplied by HTTP callers.
  if (!/^[a-zA-Z0-9_. -]{1,128}$/.test(override)) throw new Error(`Invalid Windows service name for ${id}`);
  return services.find((service) => service.Name.toLowerCase() === override.toLowerCase());
}

export async function runWindowsPowerShell(script: string): Promise<string> {
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    const { stdout } = await exec(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`$ErrorActionPreference = 'Stop'; ${script}`, "utf16le").toString("base64")], {
      windowsHide: true, timeout: 75_000, maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    throw new Error(`Windows service operation failed: ${(detail.stderr || detail.message || "Unknown error").trim().slice(-1500)}`);
  }
}

export async function discoverWindowsServices(): Promise<WindowsService[]> {
  const json = await runWindowsPowerShell("ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Service | Select-Object Name,State,StartMode,ProcessId)");
  const rows: unknown = JSON.parse(json || "[]");
  if (!Array.isArray(rows)) throw new Error("Invalid Windows service inventory");
  return rows.map((row: WindowsService) => {
    if (typeof row.Name !== "string" || typeof row.State !== "string" || typeof row.StartMode !== "string") throw new Error("Invalid Windows service record");
    return row;
  });
}

export function windowsControlScript(service: WindowsService, op: ServiceOperation): string {
  if (!["start", "stop", "restart"].includes(op)) throw new Error("Invalid Windows service operation");
  if (!/^[a-zA-Z0-9_. -]{1,128}$/.test(service.Name)) throw new Error("Invalid Windows service name");
  if (service.ProcessId === process.pid) throw new Error("Use the Windows launcher to restart or stop the service hosting this agent.");
  if (op !== "stop" && service.StartMode === "Disabled") throw new Error("This service is disabled. Enable it in Windows Services before starting it.");
  const get = `$svc = Get-Service -Name '${service.Name}' -ErrorAction Stop;`;
  const stop = "$svc.Refresh(); if ($svc.Status -ne 'Stopped') { Stop-Service -InputObject $svc -ErrorAction Stop; $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)); };";
  const start = "$svc.Refresh(); if ($svc.Status -ne 'Running') { Start-Service -InputObject $svc -ErrorAction Stop; $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)); };";
  // Do not force dependent services to stop or silently change startup settings.
  return get + (op === "start" ? start : op === "stop" ? stop : stop + start);
}

export async function controlWindowsService(id: string, op: ServiceOperation): Promise<void> {
  const service = resolveWindowsService(id, await discoverWindowsServices());
  if (!service) throw new Error(`${id} is not registered as a Windows service`);
  await runWindowsPowerShell(windowsControlScript(service, op));
}
