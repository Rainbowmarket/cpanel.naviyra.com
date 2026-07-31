#!/usr/bin/env bash
set -euo pipefail
echo "== .env BIND/DNS =="
grep -E '^(BIND_|DNS_|SERVER_PUBLIC)' /opt/naviyra-panel/.env || true
echo "== process BIND_RELOAD =="
pid=$(systemctl show -p MainPID --value naviyra-panel)
tr '\0' '\n' < "/proc/$pid/environ" | grep '^BIND_' || true
echo "== named =="
systemctl is-active named
rndc status | head -3
