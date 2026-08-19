/**
 * Locate / install PostgreSQL and run psql, pg_dump, pg_restore as the postgres OS user.
 * `sudo -u postgres psql` fails with "command not found" when the client is missing
 * or only lives under /usr/lib/postgresql/<version>/bin - always use an absolute path.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./paths";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const PSQL_TIMEOUT_MS = 2 * 60 * 1000;

export function redactPostgresError(raw: string): string {
  return String(raw)
    .replace(/PASSWORD\s+'[^']*'/gi, "PASSWORD '***'")
    .replace(/PASSWORD\s+"[^"]*"/gi, 'PASSWORD "***"')
    .replace(/password\s*=\s*'[^']*'/gi, "password='***'");
}

function versionedPgBins(name: string): string[] {
  try {
    return readdirSync("/usr/lib/postgresql")
      .sort((a, b) => Number(b) - Number(a) || b.localeCompare(a))
      .map((ver) => `/usr/lib/postgresql/${ver}/bin/${name}`);
  } catch {
    return [];
  }
}

export function findPgBin(name: "psql" | "pg_dump" | "pg_restore"): string | null {
  const candidates = [
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/bin/${name}`,
    ...versionedPgBins(name),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return file;
  }
  return null;
}

function spawnCapture(
  cmd: string,
  args: string[],
  opts: { input?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, opts.timeout ?? PSQL_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = (stderr || stdout || `${cmd} exited ${code}`).trim();
        reject(new Error(redactPostgresError(detail)));
        return;
      }
      resolve({ stdout, stderr });
    });
    if (opts.input != null) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

async function installPostgres(): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("PostgreSQL provisioning requires Linux");
  }
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error(
      "PostgreSQL is not installed. As root run: sudo bash scripts/install-postgres.sh"
    );
  }
  const script = path.join(PROJECT_ROOT, "scripts", "install-postgres.sh");
  if (existsSync(script)) {
    await spawnCapture("bash", [script, PROJECT_ROOT], { timeout: INSTALL_TIMEOUT_MS });
    return;
  }
  await spawnCapture("apt-get", ["update", "-qq"], { timeout: INSTALL_TIMEOUT_MS });
  await spawnCapture(
    "apt-get",
    ["install", "-y", "-qq", "postgresql", "postgresql-contrib"],
    { timeout: INSTALL_TIMEOUT_MS }
  );
  await spawnCapture("systemctl", ["enable", "--now", "postgresql"]).catch(() => undefined);
}

let ensureLock: Promise<string> | null = null;

export async function ensurePsqlPath(): Promise<string> {
  const existing = findPgBin("psql");
  if (existing) return existing;
  if (!ensureLock) {
    ensureLock = (async () => {
      await installPostgres();
      const bin = findPgBin("psql");
      if (!bin) {
        throw new Error("PostgreSQL was installed but psql was not found");
      }
      return bin;
    })().finally(() => {
      ensureLock = null;
    });
  }
  return ensureLock;
}

export async function ensurePostgresReady() {
  const psql = await ensurePsqlPath();
  const dir = path.dirname(psql);
  const sibling = (name: "pg_dump" | "pg_restore") => {
    const nextTo = path.join(dir, name);
    return existsSync(nextTo) ? nextTo : findPgBin(name);
  };
  return {
    psql,
    pgDump: sibling("pg_dump"),
    pgRestore: sibling("pg_restore"),
  };
}

export async function execAsPostgres(bin: string, args: string[], input?: string) {
  return spawnCapture("sudo", ["-n", "-u", "postgres", "--", bin, ...args], {
    input,
    timeout: PSQL_TIMEOUT_MS,
  });
}

export async function psqlExec(sql: string, database?: string) {
  const { psql } = await ensurePostgresReady();
  const args = ["-v", "ON_ERROR_STOP=1"];
  if (database) args.push("-d", database);
  args.push("-f", "-");
  return execAsPostgres(psql, args, sql);
}

export async function psqlQuery(sql: string, database?: string) {
  const { psql } = await ensurePostgresReady();
  const args = database ? ["-d", database, "-tAc", sql] : ["-tAc", sql];
  return execAsPostgres(psql, args);
}
