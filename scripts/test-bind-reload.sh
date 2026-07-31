#!/usr/bin/env bash
set -euo pipefail
# Load env the same way systemd does (roughly)
set -a
# shellcheck disable=SC1091
source /opt/naviyra-panel/.env
set +a
echo "BIND_RELOAD_CMD=$(printf %q "$BIND_RELOAD_CMD")"
# Strip quotes if present
CMD=${BIND_RELOAD_CMD#\"}
CMD=${CMD%\"}
echo "normalized=$CMD"
# Test exec like the panel
node - <<'NODE'
const raw = process.env.BIND_RELOAD_CMD || "";
const value = raw.trim().replace(/^["']|["']$/g, "");
const command = !value || value === "rndc" ? "rndc reload" : value;
const [cmd, ...args] = command.split(/\s+/).filter(Boolean);
console.log("exec", cmd, args);
const { execFileSync } = require("child_process");
execFileSync(cmd, args, { stdio: "inherit" });
NODE
