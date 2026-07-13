import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";

/**
 * Check if the current process has administrator / root privileges.
 * Required on Linux for live agent mode (Nginx, mail, FTP, SSL, /var/www).
 * Optional on Windows when AGENT_DRY_RUN=true.
 */
export function hasAdminPermission() {
  if (isWindows) {
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { encoding: "utf8", windowsHide: true }
    );
    return (result.stdout || "").trim() === "True";
  }

  if (typeof process.getuid === "function") {
    return process.getuid() === 0;
  }

  return false;
}

export function getPermissionLabel() {
  if (hasAdminPermission()) {
    return isWindows ? "Administrator" : "root";
  }
  return isWindows ? "Standard user" : "non-root user";
}

export function getPlatformName() {
  if (isWindows) return "Windows";
  if (isLinux) return "Linux";
  if (isMac) return "macOS";
  return process.platform;
}

export function getAdminGuidance(liveMode) {
  if (!liveMode) {
    return "Dry-run mode — admin not required. Commands are simulated.";
  }

  if (hasAdminPermission()) {
    return "Running with admin — full server control enabled.";
  }

  if (isWindows) {
    return "Live mode needs Administrator. Use 'Start Naviyra Panel (Admin).bat'.";
  }

  return "Live mode needs root. Use: sudo ./start-admin.sh";
}
