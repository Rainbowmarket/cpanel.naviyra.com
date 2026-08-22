/**
 * Git clone/pull into a site document root.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { assertPathUnderTenantRoot } from "./hostname";

const exec = promisify(execFile);
const isWindows = process.platform === "win32";

export function assertGitUrl(raw: string): string {
  const url = raw.trim();
  if (!url || url.length > 500) throw new Error("Invalid repository URL");
  if (/[\r\n;|&`$<>\\]/.test(url)) throw new Error("Invalid repository URL");
  if (
    url.startsWith("https://") ||
    url.startsWith("http://") ||
    url.startsWith("ssh://") ||
    /^git@[\w.-]+:[\w./~+-]+\.git$/i.test(url)
  ) {
    return url;
  }
  throw new Error("Use an https://, ssh://, or git@host:path.git URL");
}

export function assertGitBranch(raw: string): string {
  const branch = raw.trim() || "main";
  if (!/^[A-Za-z0-9._/\-]{1,200}$/.test(branch)) {
    throw new Error("Invalid branch name");
  }
  return branch;
}

async function git(
  args: string[],
  cwd?: string,
  timeout = 120000
): Promise<{ stdout: string; stderr: string }> {
  return exec("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

async function dirHasGit(root: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(root, ".git"));
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

async function dirIsEmpty(root: string): Promise<boolean> {
  try {
    const names = await fs.readdir(root);
    return names.filter((n) => n !== "lost+found" && n !== ".keep").length === 0;
  } catch {
    return true;
  }
}

export async function gitDeployOnServer(input: {
  documentRoot: string;
  repoUrl: string;
  branch: string;
  dryRun: boolean;
}): Promise<{
  documentRoot: string;
  branch: string;
  commit: string | null;
  action: "clone" | "pull" | "dry-run";
  dryRun: boolean;
}> {
  const documentRoot = await assertPathUnderTenantRoot(input.documentRoot);
  const repoUrl = assertGitUrl(input.repoUrl);
  const branch = assertGitBranch(input.branch);

  if (isWindows || input.dryRun) {
    return {
      documentRoot,
      branch,
      commit: null,
      action: "dry-run",
      dryRun: true,
    };
  }

  await fs.mkdir(documentRoot, { recursive: true });
  const existing = await dirHasGit(documentRoot);
  let action: "clone" | "pull" = "pull";

  if (existing) {
    await git(["remote", "set-url", "origin", repoUrl], documentRoot);
    await git(["fetch", "--depth", "1", "origin", branch], documentRoot, 180000);
    await git(["checkout", "-f", "FETCH_HEAD"], documentRoot);
  } else {
    if (!(await dirIsEmpty(documentRoot))) {
      throw new Error(
        "Document root is not empty and is not a git checkout. Empty the folder first, or deploy into an existing clone."
      );
    }
    action = "clone";
    await git(
      ["clone", "--depth", "1", "--branch", branch, repoUrl, documentRoot],
      undefined,
      180000
    );
  }

  const { stdout } = await git(["rev-parse", "--short", "HEAD"], documentRoot, 15000);
  return {
    documentRoot,
    branch,
    commit: stdout.trim() || null,
    action,
    dryRun: false,
  };
}
