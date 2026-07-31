#!/usr/bin/env bash
set -euo pipefail
ENV_FILE=/opt/naviyra-panel/.env

python3 - <<'PY'
from pathlib import Path
p = Path("/opt/naviyra-panel/.env")
text = p.read_text() if p.exists() else ""
updates = {
    "BIND_ZONES_DIR": "/etc/bind/zones",
    "BIND_NAMED_DIR": "/etc/bind/naviyra-zones.d",
    "BIND_INCLUDE_FILE": "/etc/bind/naviyra-zones.conf",
    "BIND_RELOAD_CMD": '"rndc reload"',
}
lines = text.splitlines()
seen = set()
out = []
for line in lines:
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        out.append(line)
        continue
    k = line.split("=", 1)[0].strip()
    if k in updates:
        out.append(f"{k}={updates[k]}")
        seen.add(k)
    else:
        out.append(line)
for k, v in updates.items():
    if k not in seen:
        out.append(f"{k}={v}")
p.write_text("\n".join(out) + "\n")
print("env updated")
PY

echo "== BIND lines =="
grep -E '^BIND_' "$ENV_FILE"

# Patch running source so bare "rndc" still works after future misconfig
python3 - <<'PY'
from pathlib import Path

def patch(path: Path):
    if not path.exists():
        return
    text = path.read_text()
    old = '''export function getBindReloadCmd(): string | undefined {
  return process.env.BIND_RELOAD_CMD || "rndc reload";
}'''
    new = '''export function getBindReloadCmd(): string {
  return normalizeBindReloadCmd(process.env.BIND_RELOAD_CMD);
}

export function normalizeBindReloadCmd(raw: string | undefined | null): string {
  const value = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!value || value === "rndc") return "rndc reload";
  if (value === "systemctl") return "systemctl reload named";
  return value;
}'''
    if "normalizeBindReloadCmd" in text:
        print(path, "already patched")
        return
    if old in text:
        path.write_text(text.replace(old, new))
        print(path, "patched")
    else:
        # try without undefined return type
        old2 = '''export function getBindReloadCmd(): string {
  return process.env.BIND_RELOAD_CMD ?? "rndc reload";
}'''
        if old2 in text:
            path.write_text(text.replace(old2, new))
            print(path, "patched (src)")
        else:
            print(path, "skip (pattern not found)")

patch(Path("/opt/naviyra-panel/agent/paths.ts"))
patch(Path("/opt/naviyra-panel/src/lib/paths.ts"))
PY

# Harden agent dns runReload in compiled or source if present
if [ -f /opt/naviyra-panel/agent/dns.ts ]; then
  python3 - <<'PY'
from pathlib import Path
p = Path("/opt/naviyra-panel/agent/dns.ts")
text = p.read_text()
if "systemctl reload named" in text and "if (cmd === \"rndc\")" in text:
    print("agent/dns.ts already hardened")
else:
    old = '''async function runReload(bindReloadCmd: string | undefined, dryRun: boolean) {
  if (!bindReloadCmd || dryRun) return;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const [cmd, ...args] = bindReloadCmd.split(/\\s+/);
  await exec(cmd, args);
}'''
    new = '''async function runReload(bindReloadCmd: string | undefined, dryRun: boolean) {
  if (!bindReloadCmd || dryRun) return;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  const normalized = bindReloadCmd.trim().replace(/^["']|["']$/g, "");
  const command =
    !normalized || normalized === "rndc"
      ? "rndc reload"
      : normalized === "systemctl"
        ? "systemctl reload named"
        : normalized;

  const [cmd, ...args] = command.split(/\\s+/).filter(Boolean);
  if (!cmd) return;

  try {
    await exec(cmd, args);
  } catch (error) {
    if (cmd === "rndc") {
      await exec("systemctl", ["reload", "named"]);
      return;
    }
    throw error;
  }
}'''
    if old in text:
        p.write_text(text.replace(old, new))
        print("agent/dns.ts patched")
    else:
        print("agent/dns.ts pattern not found")
PY
fi

systemctl restart naviyra-panel
sleep 3
systemctl is-active naviyra-panel
pid=$(systemctl show -p MainPID --value naviyra-panel)
echo "process BIND_RELOAD:"
tr '\0' '\n' < /proc/$pid/environ | grep BIND_RELOAD || true
