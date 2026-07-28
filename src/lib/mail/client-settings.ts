/** Shared IMAP/SMTP client settings for welcome mail + mail host portal page. */

export function getMailClientHost(domainName: string): string {
  const template = process.env.MAIL_HOSTNAME ?? "mail.{domain}";
  return template.replace(/\{domain\}/g, domainName);
}

export function getPanelWebmailUrl(): string {
  const configured = process.env.PANEL_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const ip = process.env.SERVER_PUBLIC_IP?.trim() || "127.0.0.1";
  const port = process.env.PANEL_PORT?.trim() || "3100";
  return `http://${ip}:${port}`;
}

export function buildMailClientSettingsText(input: {
  email: string;
  mailHost: string;
  panelUrl: string;
}): string {
  const { email, mailHost, panelUrl } = input;
  return [
    `Your mailbox ${email} is ready.`,
    "",
    "=== Webmail (browser) ===",
    `Open: https://${mailHost}`,
    "Sign in with your full email address and mailbox password.",
    `(Panel backup: ${panelUrl}/webmail)`,
    "",
    "=== Mobile / desktop mail app ===",
    `Email / username: ${email}`,
    "Password: (the mailbox password you set in the panel)",
    "",
    "Incoming (IMAP)",
    `  Server:   ${mailHost}`,
    "  Port:     993",
    "  Security: SSL/TLS",
    "",
    "Outgoing (SMTP)",
    `  Server:   ${mailHost}`,
    "  Port:     587 (STARTTLS)  or  465 (SSL/TLS)",
    "  Security: STARTTLS or SSL/TLS",
    "  Auth:     Yes (same username + password)",
    "",
    "Optional POP3",
    `  Server:   ${mailHost}`,
    "  Port:     995 (SSL/TLS)",
    "",
    "Folders: Inbox, Drafts, Sent, Trash, Archive, Junk",
  ].join("\n");
}

export function buildMailPortalHtml(input: {
  mailHost: string;
  domainName: string;
  panelUrl: string;
}): string {
  const { mailHost, domainName, panelUrl } = input;
  const webmail = `https://${mailHost}/webmail`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mail · ${domainName}</title>
  <meta http-equiv="refresh" content="0;url=${webmail}" />
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: system-ui,sans-serif; background:#0f172a; color:#e2e8f0; }
    .wrap { max-width:720px; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
    a.btn { display:inline-block; background:#059669; color:#fff; text-decoration:none;
      padding:.7rem 1.1rem; border-radius:10px; font-weight:600; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${mailHost}</h1>
    <p>Redirecting to webmail login…</p>
    <p><a class="btn" href="${webmail}">Open webmail login</a></p>
    <p style="color:#94a3b8;margin-top:1rem">Backup: <a href="${panelUrl}/webmail">${panelUrl}/webmail</a></p>
  </div>
</body>
</html>
`;
}
