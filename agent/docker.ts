/**
 * Docker / Compose helpers for the host agent.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { assertPathUnderTenantRoot } from "./hostname";

const exec = promisify(execFile);
const isWindows = process.platform === "win32";

function assertContainerId(id: string) {
  if (!/^[a-zA-Z0-9]{8,64}$/.test(id.trim())) {
    throw new Error("Invalid container id");
  }
  return id.trim();
}

async function docker(
  args: string[],
  timeout = 30000
): Promise<{ stdout: string; stderr: string }> {
  return exec("docker", args, { timeout, maxBuffer: 4 * 1024 * 1024 });
}

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
};

export async function listDockerContainers(input: { dryRun: boolean }): Promise<{
  containers: DockerContainer[];
  available: boolean;
  dryRun: boolean;
}> {
  if (isWindows || input.dryRun) {
    return { containers: [], available: false, dryRun: true };
  }
  try {
    const { stdout } = await docker(["ps", "-a", "--format", "{{json .}}"]);
    const containers: DockerContainer[] = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const row = JSON.parse(line) as Record<string, string>;
        return {
          id: row.ID || row.Id || "",
          name: row.Names || row.Name || "",
          image: row.Image || "",
          status: row.Status || "",
          state: row.State || "",
          ports: row.Ports || "",
        };
      });
    return { containers, available: true, dryRun: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/not found|ENOENT|Cannot connect/i.test(msg)) {
      return { containers: [], available: false, dryRun: false };
    }
    throw new Error(msg.replace(/^Command failed:.*\n?/i, "").slice(0, 400));
  }
}

export async function controlDockerContainer(input: {
  id: string;
  op: "start" | "stop" | "restart";
  dryRun: boolean;
}): Promise<{ id: string; op: string; dryRun: boolean }> {
  const id = assertContainerId(input.id);
  if (isWindows || input.dryRun) {
    return { id, op: input.op, dryRun: true };
  }
  await docker([input.op, id], 60000);
  return { id, op: input.op, dryRun: false };
}

export async function dockerContainerLogs(input: {
  id: string;
  lines?: number;
  dryRun: boolean;
}): Promise<{ id: string; logs: string; dryRun: boolean }> {
  const id = assertContainerId(input.id);
  const lines = Math.max(20, Math.min(200, Number(input.lines ?? 80) || 80));
  if (isWindows || input.dryRun) {
    return { id, logs: "", dryRun: true };
  }
  const { stdout, stderr } = await docker(["logs", "--tail", String(lines), id]);
  return { id, logs: (stdout || stderr || "").slice(-80_000), dryRun: false };
}

export async function dockerComposeUp(input: {
  composePath: string;
  documentRoot: string;
  dryRun: boolean;
}): Promise<{ composePath: string; dryRun: boolean }> {
  const root = path.resolve(input.documentRoot);
  const composePath = await assertPathUnderTenantRoot(
    input.composePath,
    root
  );
  const base = path.basename(composePath).toLowerCase();
  if (
    base !== "docker-compose.yml" &&
    base !== "docker-compose.yaml" &&
    base !== "compose.yml" &&
    base !== "compose.yaml"
  ) {
    throw new Error("Compose file must be docker-compose.yml or compose.yaml");
  }
  await fs.access(composePath);
  if (isWindows || input.dryRun) {
    return { composePath, dryRun: true };
  }
  try {
    await exec("docker", ["compose", "-f", composePath, "up", "-d"], {
      timeout: 180000,
      cwd: path.dirname(composePath),
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    await exec("docker-compose", ["-f", composePath, "up", "-d"], {
      timeout: 180000,
      cwd: path.dirname(composePath),
      maxBuffer: 4 * 1024 * 1024,
    });
  }
  return { composePath, dryRun: false };
}
