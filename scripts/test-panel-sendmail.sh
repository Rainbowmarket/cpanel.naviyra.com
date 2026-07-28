#!/usr/bin/env bash
set -euo pipefail
echo "sendmail=$(command -v sendmail)"
ls -la /usr/sbin/sendmail
grep -n "sendViaPostfix\|sendmail\|spawn" /opt/naviyra-panel/src/lib/mail/store.ts | head -20
echo "=== recent panel logs ==="
journalctl -u naviyra-panel --no-pager -n 100 | grep -iE 'sendmail|compose|mail|Error|error' | tail -50 || true
echo "=== node sendmail test ==="
node <<'NODE'
const { spawn } = require("child_process");
const raw = [
  "From: info@kongunattugounder.com",
  "To: naveensubramani021@gmail.com",
  "Subject: node panel-style send test",
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "Sent via node spawn like the panel does.",
  "",
].join("\r\n");
const child = spawn("/usr/sbin/sendmail", ["-t", "-i", "-f", "info@kongunattugounder.com"], {
  stdio: ["pipe", "ignore", "pipe"],
});
let err = "";
child.stderr.on("data", (d) => (err += d));
child.on("close", (code) => {
  console.log("exit", code, "stderr", err || "(empty)");
});
child.stdin.write(raw);
child.stdin.end();
NODE
sleep 2
mailq || true
grep "node panel-style\|naveensubramani021" /var/log/mail.log | tail -10 || true
