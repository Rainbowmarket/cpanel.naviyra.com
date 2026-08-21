export type AppMode = "development" | "production";

export const APP_TYPES = ["STATIC", "PHP", "PYTHON", "GO", "NODE"] as const;

export function isProxyAppType(appType: string): boolean {
  return appType === "PYTHON" || appType === "GO" || appType === "NODE";
}

export function phpEnabledForAppType(appType: string): boolean {
  return appType === "PHP";
}

/** Map app/main.py → app.main for uvicorn. */
export function pythonModuleFromStartupFile(startupFile?: string | null): string {
  const file =
    (startupFile || "main.py").trim().replace(/^[/\\]+/, "") || "main.py";
  return file.replace(/\.py$/i, "").replace(/\\/g, "/").replace(/\//g, ".");
}

/** FastAPI/Starlette via uvicorn, binding the panel-allocated PORT. */
export function fastapiStartCommand(startupFile?: string | null): string {
  const mod = pythonModuleFromStartupFile(startupFile);
  return `python3 -m uvicorn ${mod}:app --host 127.0.0.1 --port $PORT`;
}

/** Keep uvicorn target in sync with Application startup file (app/main.py → app.main:app). */
export function syncUvicornModule(
  command: string,
  startupFile?: string | null
): string {
  if (!/\buvicorn\b/.test(command)) return command;
  const mod = pythonModuleFromStartupFile(startupFile);
  return command.replace(/(\buvicorn\s+)([A-Za-z0-9_.]+)(:)/, `$1${mod}$3`);
}

/** If the command would run a .py file and exit, bind it with uvicorn instead. */
export function ensureLongRunningPythonCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (/\b(uvicorn|gunicorn|hypercorn|daphne)\b/.test(trimmed)) return trimmed;
  const fileMatch = trimmed.match(
    /(?:python3?|python)\s+(?:-u\s+)?(\S+\.py)\s*$/i
  );
  if (fileMatch?.[1]) {
    return fastapiStartCommand(fileMatch[1]);
  }
  return trimmed;
}

/** Build default ExecStart from startup file when start command is empty. */
export function resolveStartCommand(opts: {
  appType: string;
  startCommand?: string | null;
  appStartupFile?: string | null;
}): string {
  const explicit = opts.startCommand?.trim() || "";
  if (explicit) {
    if (opts.appType === "PYTHON") {
      return ensureLongRunningPythonCommand(
        syncUvicornModule(explicit, opts.appStartupFile)
      );
    }
    return explicit;
  }
  const file = (opts.appStartupFile || "").trim().replace(/^[/\\]+/, "");
  if (!file || file.includes("..") || /[;&|<>`$]/.test(file)) return "";
  if (opts.appType === "NODE") return `node ${file}`;
  if (opts.appType === "PYTHON") return fastapiStartCommand(file || "app.py");
  if (opts.appType === "GO") return file.startsWith("./") ? file : `./${file}`;
  return "";
}

/** Application root is relative to the site document root. `.` means the site folder. */
export function normalizeAppWorkingDir(
  value: string,
  documentRoot?: string | null
): string {
  const raw = (value || ".").trim().replace(/\\/g, "/") || ".";
  if (raw === "." || raw === "./") return ".";
  if (raw.includes("..")) {
    throw new Error("Application root cannot contain ..");
  }
  const root = (documentRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (root) {
    const abs = raw.replace(/\/+$/, "");
    if (abs === root) return ".";
    if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1) || ".";
  }
  if (raw.startsWith("/")) {
    throw new Error(
      "Application root must be relative to the site folder. Use . not a /var/www path."
    );
  }
  return raw.replace(/^\/+/, "");
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

/** Customer apps must not log in as the PostgreSQL superuser. */
export function assertCustomerAppDatabaseEnv(appEnv: string | null | undefined) {
  if (!appEnv?.trim()) return;
  for (const line of appEnv.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim().toUpperCase();
    const value = t
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .toLowerCase();
    if (
      (key === "DB_USER" ||
        key === "POSTGRES_USER" ||
        key === "PGUSER" ||
        key === "DATABASE_USER") &&
      (value === "postgres" || value === "root")
    ) {
      throw new Error(
        "Do not use DB_USER=postgres. Use the database name from Databases as both DB_USER and DB_NAME."
      );
    }
  }
}
