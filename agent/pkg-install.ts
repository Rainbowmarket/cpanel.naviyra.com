import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./paths";

const exec = promisify(execFile);
const APT_MS = 12 * 60 * 1000;

export async function whichBin(bin: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await exec(cmd, [bin]);
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function assertLinuxRoot() {
  if (process.platform === "win32") {
    throw new Error("Package install requires a Linux agent (not Windows dry-run).");
  }
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error("The agent must run as root to install packages.");
  }
}

async function run(
  file: string,
  args: string[],
  opts?: { timeout?: number; env?: NodeJS.ProcessEnv }
) {
  return exec(file, args, {
    timeout: opts?.timeout ?? 120000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive", ...opts?.env },
  });
}

async function enableServices(names: string[]) {
  for (const name of names) {
    try {
      await run("systemctl", ["enable", "--now", name], { timeout: 60000 });
    } catch {
      try {
        await run("service", [name, "start"], { timeout: 60000 });
      } catch {
        /* service unit names differ by distro */
      }
    }
  }
}

/** Install the first package set that succeeds (apt or dnf). */
export async function installPackages(input: {
  dryRun: boolean;
  name: string;
  packageSets: string[][];
  services?: string[];
}): Promise<{ detail: string }> {
  if (input.dryRun) {
    return {
      detail: `dry-run: would install ${input.name} (${input.packageSets[0]?.join(", ")})`,
    };
  }
  assertLinuxRoot();

  const apt = fs.existsSync("/usr/bin/apt-get");
  const dnf = fs.existsSync("/usr/bin/dnf") || fs.existsSync("/usr/bin/yum");
  if (!apt && !dnf) {
    throw new Error("No apt-get or dnf on this host. Install packages manually.");
  }

  const errors: string[] = [];
  for (const pkgs of input.packageSets) {
    try {
      if (apt) {
        await run("apt-get", ["update", "-y"], { timeout: APT_MS });
        await run("apt-get", ["install", "-y", ...pkgs], { timeout: APT_MS });
      } else {
        const yum = fs.existsSync("/usr/bin/dnf") ? "dnf" : "yum";
        await run(yum, ["install", "-y", ...pkgs], { timeout: APT_MS });
      }
      await enableServices(input.services ?? []);
      return { detail: `Installed ${pkgs.join(", ")} and started ${input.name}` };
    } catch (error) {
      errors.push(
        `${pkgs.join(" ")}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  throw new Error(`Could not install ${input.name}. ${errors.slice(-1)[0] ?? ""}`.trim());
}

export async function runPanelScript(
  scriptName: string,
  dryRun: boolean,
  extraArgs: string[] = []
): Promise<{ detail: string } | null> {
  const script = path.join(PROJECT_ROOT, "scripts", scriptName);
  if (!fs.existsSync(script)) return null;
  if (dryRun) return { detail: `dry-run: would run ${scriptName}` };
  assertLinuxRoot();
  await run("bash", [script, ...extraArgs], { timeout: APT_MS });
  return { detail: `Ran scripts/${scriptName}` };
}

function ubuntuCodename(): string {
  try {
    const text = fs.readFileSync("/etc/os-release", "utf8");
    const match = /^VERSION_CODENAME=(.*)$/m.exec(text);
    return (match?.[1] || "jammy").replace(/"/g, "").trim();
  } catch {
    return "jammy";
  }
}

export async function prepareClickHouseRepo(): Promise<void> {
  try {
    assertLinuxRoot();
    await run("apt-get", ["install", "-y", "apt-transport-https", "ca-certificates", "curl", "gnupg"], {
      timeout: APT_MS,
    });
    const keyring = "/usr/share/keyrings/clickhouse-keyring.gpg";
    if (!fs.existsSync(keyring)) {
      await run("bash", [
        "-lc",
        `curl -fsSL 'https://packages.clickhouse.com/deb/lts/Release.key' | gpg --dearmor -o ${keyring}`,
      ], { timeout: 120000 });
    }
    fs.writeFileSync(
      "/etc/apt/sources.list.d/clickhouse.list",
      "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main\n"
    );
  } catch {
    /* distro packages may still exist */
  }
}

/** Add MongoDB 7 apt repo (not in default Ubuntu). */
export async function prepareMongoRepo(): Promise<void> {
  try {
    assertLinuxRoot();
    await run("apt-get", ["install", "-y", "ca-certificates", "curl", "gnupg"], { timeout: APT_MS });
    const keyring = "/usr/share/keyrings/mongodb-server-7.0.gpg";
    if (!fs.existsSync(keyring)) {
      await run("bash", [
        "-lc",
        `curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o ${keyring}`,
      ], { timeout: 120000 });
    }
    const codename = ubuntuCodename();
    fs.writeFileSync(
      "/etc/apt/sources.list.d/mongodb-org-7.0.list",
      `deb [ signed-by=${keyring} ] https://repo.mongodb.org/apt/ubuntu ${codename}/mongodb-org/7.0 multiverse\n`
    );
  } catch {
    /* distro packages may still exist */
  }
}

export { run as runHostCommand };
