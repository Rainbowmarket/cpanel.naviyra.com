export type AppMode = "development" | "production";

export const APP_TYPES = ["STATIC", "PHP", "PYTHON", "GO", "NODE"] as const;

export function isProxyAppType(appType: string): boolean {
  return appType === "PYTHON" || appType === "GO" || appType === "NODE";
}

export function phpEnabledForAppType(appType: string): boolean {
  return appType === "PHP";
}

/** Build default ExecStart from startup file when start command is empty. */
export function resolveStartCommand(opts: {
  appType: string;
  startCommand?: string | null;
  appStartupFile?: string | null;
}): string {
  const explicit = opts.startCommand?.trim() || "";
  if (explicit) return explicit;
  const file = (opts.appStartupFile || "").trim().replace(/^[/\\]+/, "");
  if (!file || file.includes("..") || /[;&|<>`$]/.test(file)) return "";
  if (opts.appType === "NODE") return `node ${file}`;
  if (opts.appType === "PYTHON") return `python3 ${file}`;
  if (opts.appType === "GO") return file.startsWith("./") ? file : `./${file}`;
  return "";
}

/** Merge Application mode into KEY=VALUE env text without wiping other keys. */
export function mergeAppModeEnv(
  appEnv: string | null | undefined,
  mode: AppMode | null | undefined
): string | null {
  const lines = (appEnv ?? "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t || t.startsWith("#")) return true;
      const key = t.split("=", 1)[0]?.trim();
      return key !== "NODE_ENV" && key !== "APP_ENV";
    });
  if (mode === "development" || mode === "production") {
    lines.push(`NODE_ENV=${mode}`);
    lines.push(`APP_ENV=${mode}`);
  }
  const out = lines.join("\n").trim();
  return out.length ? out : null;
}

export function parseAppModeFromEnv(
  appEnv: string | null | undefined
): AppMode {
  const m = /^NODE_ENV=(development|production)\s*$/m.exec(appEnv ?? "");
  if (m?.[1] === "development" || m?.[1] === "production") return m[1];
  return "production";
}
