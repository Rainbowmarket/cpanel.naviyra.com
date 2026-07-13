import { spawnSync } from "node:child_process";

export function hasAdminPermission(): boolean {
  if (process.platform === "win32") {
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

export function getPermissionLabel(): string {
  if (hasAdminPermission()) {
    return process.platform === "win32" ? "Administrator" : "root";
  }
  return process.platform === "win32" ? "Standard user" : "non-root user";
}

export function getPlatformName(): string {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "linux") return "Linux";
  if (process.platform === "darwin") return "macOS";
  return process.platform;
}
