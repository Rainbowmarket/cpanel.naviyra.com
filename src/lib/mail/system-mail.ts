import { spawn } from "node:child_process";
import { getPanelBaseDomain } from "@/lib/base-domain";

function panelPublicUrl(): string {
  const configured = process.env.PANEL_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const base = getPanelBaseDomain();
  if (base) return `https://${base}`;
  return "http://localhost:3100";
}

/** From address for password reset / system mail (MAIL_FROM or noreply@{PANEL_HOSTNAME}). */
export function getSystemMailFromAddress(): string {
  const configured = process.env.MAIL_FROM?.trim();
  if (configured) return configured;
  const base = getPanelBaseDomain();
  return base ? `noreply@${base}` : "noreply@localhost";
}

function systemFromAddress(): string {
  return getSystemMailFromAddress();
}

function buildRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.text,
    "",
  ];
  return lines.join("\r\n");
}

async function sendViaSendmail(raw: string, fromEmail: string): Promise<void> {
  if (process.platform === "win32") {
    throw new Error(
      "Password reset email requires the Linux mail server (sendmail)."
    );
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "/usr/sbin/sendmail",
      ["-t", "-i", "-f", fromEmail],
      { stdio: ["pipe", "ignore", "pipe"] }
    );
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `sendmail exited ${code}`));
    });
    child.stdin.write(raw);
    child.stdin.end();
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  const from = systemFromAddress();
  const resetUrl = `${panelPublicUrl()}/login/reset?token=${encodeURIComponent(opts.token)}`;
  const text = [
    `Hi ${opts.name},`,
    "",
    "We received a request to reset your Naviyra Panel password.",
    "Open this link within 1 hour to choose a new password:",
    "",
    resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
    "",
    "— Naviyra Panel",
  ].join("\n");

  const raw = buildRawMessage({
    from: `Naviyra Panel <${from}>`,
    to: opts.to,
    subject: "Reset your Naviyra Panel password",
    text,
  });

  await sendViaSendmail(raw, from);
}
