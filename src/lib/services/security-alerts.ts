import os from "node:os";
import {
  forgetAlertFingerprints,
  listAlertFingerprints,
  notifyAdmins,
  readAlertFingerprintTime,
  rememberAlertFingerprint,
} from "@/lib/mail/admin-alerts";
import {
  collectPublicListeningPorts,
  portFingerprint,
  type ListeningPort,
} from "@/lib/system/listening-ports";
import { collectSshRootLoginsSince } from "@/lib/system/ssh-root-logins";

const PORT_PREFIX = "port:";
const PORT_BASELINE = "ports-baseline";
const SSH_CURSOR = "ssh-root-cursor";

function formatPort(entry: ListeningPort): string {
  return `${entry.proto.toUpperCase()} ${entry.port} (${entry.addresses.join(", ")})`;
}

async function evaluateNewPorts(hostname: string) {
  const current = await collectPublicListeningPorts();
  const currentKeys = current.map((entry) => portFingerprint(entry));
  const known = await listAlertFingerprints("security", PORT_PREFIX);
  const baseline = await readAlertFingerprintTime("security", PORT_BASELINE);

  if (!baseline) {
    for (const key of currentKeys) {
      await rememberAlertFingerprint("security", key);
    }
    await rememberAlertFingerprint("security", PORT_BASELINE);
    return { newPorts: [] as ListeningPort[], baseline: true };
  }

  const knownSet = new Set(known);
  const currentSet = new Set(currentKeys);
  const added = current.filter((entry) => !knownSet.has(portFingerprint(entry)));
  const gone = known.filter((key) => !currentSet.has(key));
  if (gone.length) await forgetAlertFingerprints("security", gone);

  for (const entry of added) {
    const key = portFingerprint(entry);
    await notifyAdmins({
      kind: "security",
      fingerprint: key,
      once: true,
      title: `New listening port on ${hostname}: ${entry.proto.toUpperCase()} ${entry.port}`,
      detail: [
        `Host: ${hostname}`,
        `A new public listening port was detected.`,
        "",
        formatPort(entry),
        "",
        "If you did not enable this service, investigate immediately (ss -lntup, firewall, and running processes).",
      ].join("\n"),
    });
    await rememberAlertFingerprint("security", key);
  }

  return { newPorts: added, baseline: false };
}

async function evaluateRootLogins(hostname: string) {
  const cursor =
    (await readAlertFingerprintTime("security", SSH_CURSOR)) ?? null;
  if (!cursor) {
    await rememberAlertFingerprint("security", SSH_CURSOR);
    return { rootLogins: 0, seeded: true };
  }

  const logins = await collectSshRootLoginsSince(cursor);
  let mailed = 0;
  let handled = 0;
  for (const login of logins) {
    const fingerprint = `ssh-root:${login.at.toISOString()}:${login.ip}:${login.port}:${login.method}`;
    const sent = await notifyAdmins({
      kind: "security",
      fingerprint,
      once: true,
      title: `Root SSH login on ${hostname} from ${login.ip}`,
      detail: [
        `Host: ${hostname}`,
        `A successful SSH login as root was recorded.`,
        "",
        `Time: ${login.at.toISOString()}`,
        `Source IP: ${login.ip}`,
        `Source port: ${login.port}`,
        `Method: ${login.method}`,
        "",
        `Log: ${login.raw}`,
        "",
        "If this was not you, change the root password from a console/KVM session, disable PasswordAuthentication, and check for unknown processes/cron.",
      ].join("\n"),
    });
    if (sent) mailed += 1;
    if (sent || (await readAlertFingerprintTime("security", fingerprint))) {
      handled += 1;
    }
  }

  if (logins.length > 0 && handled === logins.length) {
    await rememberAlertFingerprint("security", SSH_CURSOR, logins.at(-1)!.at);
  }

  return { rootLogins: mailed, seeded: false };
}

/** Detect new public ports and root SSH logins; email every admin user. */
export async function runScheduledSecurityAlerts() {
  const hostname = os.hostname() || "controller";
  const [ports, ssh] = await Promise.all([
    evaluateNewPorts(hostname),
    evaluateRootLogins(hostname),
  ]);
  return {
    hostname,
    newPorts: ports.newPorts.map(formatPort),
    portsBaseline: ports.baseline,
    rootLoginsMailed: ssh.rootLogins,
    sshCursorSeeded: ssh.seeded,
  };
}
