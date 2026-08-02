/**
 * Production deploy: pack sources → upload → run scripts/remote-deploy.sh
 *
 * Local packaging/upload only — not part of the web panel.
 *
 * Reads from .env (never printed to stdout/logs):
 *   DEPLOY_HOST       (or SERVER_PUBLIC_IP)
 *   DEPLOY_USER       (default root)
 *   DEPLOY_PASSWORD   (optional; omit to use SSH keys — preferred)
 *   DEPLOY_PORT       (default 22)
 *
 * Password handling avoids argv visibility (ps / Task Manager):
 *   - OpenSSH + sshpass: SSHPASS env + `sshpass -e` (never `-p`)
 *   - PuTTY: `-pwfile` (temp file, deleted after); requires PuTTY ≥ 0.78
 * Prefer leaving DEPLOY_PASSWORD empty and using SSH key auth.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(ROOT, ".env") });

const EXCLUDES = [
  "node_modules",
  "agent/node_modules",
  "security-manager/frontend/node_modules",
  ".next",
  "out",
  "dist",
  "data",
  "sites",
  ".git",
  ".env",
  ".env.local",
  "Output",
  "*.db",
  "*.db-journal",
  ".DS_Store",
];

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function which(cmd) {
  const r = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [cmd],
    { encoding: "utf8", shell: false }
  );
  if (r.status !== 0) return null;
  const line = (r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line || null;
}

function findPutty(exe) {
  const fromPath = which(exe);
  if (fromPath) return fromPath;
  const candidates = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "PuTTY", exe),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "PuTTY",
      exe
    ),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function puttySupportsPwfile(plink) {
  const r = spawnSync(plink, ["--help"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const help = `${r.stdout || ""}\n${r.stderr || ""}`;
  return help.includes("-pwfile");
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    ...opts,
  });
  if (r.error) die(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) die(`${cmd} failed (exit ${r.status})`, r.status || 1);
}

function packArchive(archivePath) {
  if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  const excludeArgs = EXCLUDES.flatMap((pattern) => ["--exclude", pattern]);
  const args = ["-czf", archivePath, ...excludeArgs, "-C", ROOT, "."];
  console.log("Packing sources…");
  run("tar", args);
  const mb = (fs.statSync(archivePath).size / (1024 * 1024)).toFixed(2);
  console.log(`Archive: ${archivePath} (${mb} MB)`);
}

/** Write password to a short-lived temp file; wipe + unlink when done. */
function withPasswordFile(password, fn) {
  const file = path.join(
    os.tmpdir(),
    `naviyra-deploy-pw-${process.pid}-${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(file, password, { encoding: "utf8", mode: 0o600 });
    return fn(file);
  } finally {
    try {
      const wipe = Buffer.alloc(Math.max(password.length, 64), 0);
      fs.writeFileSync(file, wipe);
      fs.unlinkSync(file);
    } catch {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }
}

function deployWithPutty({ host, user, password, port, archivePath, scriptPath }) {
  const pscp = findPutty("pscp.exe");
  const plink = findPutty("plink.exe");
  if (!pscp || !plink) {
    die(
      "PuTTY pscp/plink not found. Install PuTTY or use OpenSSH + sshpass / SSH keys."
    );
  }
  if (!password) {
    die(
      "PuTTY password auth needs DEPLOY_PASSWORD, or leave it empty and use OpenSSH key auth."
    );
  }
  if (!puttySupportsPwfile(plink)) {
    die(
      "This PuTTY build has no -pwfile (need ≥ 0.78).\n" +
        "Upgrade PuTTY, or leave DEPLOY_PASSWORD empty and deploy with SSH keys."
    );
  }

  const target = `${user}@${host}`;
  console.log(`Uploading to ${target}:${port} …`);

  withPasswordFile(password, (pwfile) => {
    run(pscp, [
      "-P",
      String(port),
      "-pwfile",
      pwfile,
      "-batch",
      archivePath,
      `${target}:/tmp/naviyra-panel.tgz`,
    ]);
    run(pscp, [
      "-P",
      String(port),
      "-pwfile",
      pwfile,
      "-batch",
      scriptPath,
      `${target}:/tmp/remote-deploy.sh`,
    ]);

    console.log("Running remote deploy (npm install + build + restart)…");
    run(plink, [
      "-ssh",
      target,
      "-P",
      String(port),
      "-pwfile",
      pwfile,
      "-batch",
      "chmod +x /tmp/remote-deploy.sh && bash /tmp/remote-deploy.sh",
    ]);
  });
}

function deployWithOpenSsh({ host, user, password, port, archivePath, scriptPath }) {
  const scp = which("scp");
  const ssh = which("ssh");
  if (!scp || !ssh) die("scp/ssh not found on PATH.");

  const target = `${user}@${host}`;
  const sshBase = ["-p", String(port), "-o", "StrictHostKeyChecking=accept-new"];

  if (password) {
    const sshpass = which("sshpass");
    if (!sshpass) {
      die(
        "DEPLOY_PASSWORD is set but sshpass is not installed.\n" +
          "Install sshpass, use PuTTY on Windows, or leave DEPLOY_PASSWORD empty and use SSH keys."
      );
    }
    // sshpass -e reads SSHPASS from the environment — not visible in process argv
    const env = { ...process.env, SSHPASS: password };
    console.log(`Uploading to ${target}:${port} …`);
    run(
      sshpass,
      ["-e", "scp", ...sshBase, archivePath, `${target}:/tmp/naviyra-panel.tgz`],
      { env }
    );
    run(
      sshpass,
      ["-e", "scp", ...sshBase, scriptPath, `${target}:/tmp/remote-deploy.sh`],
      { env }
    );
    console.log("Running remote deploy (npm install + build + restart)…");
    run(
      sshpass,
      [
        "-e",
        "ssh",
        ...sshBase,
        target,
        "chmod +x /tmp/remote-deploy.sh && bash /tmp/remote-deploy.sh",
      ],
      { env }
    );
    return;
  }

  console.log(`Uploading to ${target}:${port} (SSH key auth)…`);
  run(scp, [...sshBase, archivePath, `${target}:/tmp/naviyra-panel.tgz`]);
  run(scp, [...sshBase, scriptPath, `${target}:/tmp/remote-deploy.sh`]);
  console.log("Running remote deploy (npm install + build + restart)…");
  run(ssh, [
    ...sshBase,
    target,
    "chmod +x /tmp/remote-deploy.sh && bash /tmp/remote-deploy.sh",
  ]);
}

function main() {
  const host = (process.env.DEPLOY_HOST || process.env.SERVER_PUBLIC_IP || "").trim();
  const user = (process.env.DEPLOY_USER || "root").trim();
  const password = (process.env.DEPLOY_PASSWORD || "").trim();
  const port = Number(process.env.DEPLOY_PORT || "22") || 22;

  if (!host) {
    die(
      "Missing DEPLOY_HOST (or SERVER_PUBLIC_IP) in .env.\n" +
        "Example:\n  DEPLOY_HOST=136.243.196.166\n  DEPLOY_USER=root\n  DEPLOY_PASSWORD=…"
    );
  }

  const scriptPath = path.join(ROOT, "scripts", "remote-deploy.sh");
  if (!fs.existsSync(scriptPath)) die(`Missing ${scriptPath}`);

  const archivePath = path.join(os.tmpdir(), "naviyra-panel-upload.tgz");
  packArchive(archivePath);

  const opts = { host, user, password, port, archivePath, scriptPath };
  const preferPutty =
    process.platform === "win32" &&
    Boolean(password) &&
    Boolean(findPutty("pscp.exe"));

  if (preferPutty) {
    deployWithPutty(opts);
  } else {
    deployWithOpenSsh(opts);
  }

  try {
    fs.unlinkSync(archivePath);
  } catch {
    /* ignore */
  }

  console.log(`DEPLOY_OK → ${user}@${host}:${port}`);
}

main();
