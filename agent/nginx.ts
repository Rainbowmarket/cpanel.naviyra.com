/**
 * Linux nginx + Let's Encrypt helpers for Naviyra agent
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const SITES_AVAILABLE = "/etc/nginx/sites-available";
const SITES_ENABLED = "/etc/nginx/sites-enabled";
const ACME_WEBROOT = "/var/www/certbot";

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Build host list for certificates / server_name. Never invents www.* unless asked. */
export function expandSslHosts(
  domain: string,
  extraLabels: string[] = []
): string[] {
  const hosts = new Set<string>([domain]);
  for (const extra of extraLabels) {
    const value = String(extra).trim();
    if (!value) continue;
    if (value === "www") {
      hosts.add(`www.${domain}`);
      continue;
    }
    if (value.includes(".")) {
      hosts.add(value);
      continue;
    }
    hosts.add(`${value}.${domain}`);
  }
  return Array.from(hosts);
}

export function buildHttpVhost(hosts: string[], documentRoot: string): string {
  const serverName = hosts.join(" ");
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverName};

    root ${documentRoot};
    index index.html index.htm index.php;

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type text/plain;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
`;
}

export function buildHttpsVhost(
  hosts: string[],
  documentRoot: string,
  certDir: string
): string {
  const serverName = hosts.join(" ");
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverName};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type text/plain;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${serverName};

    ssl_certificate     ${certDir}/fullchain.pem;
    ssl_certificate_key ${certDir}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root ${documentRoot};
    index index.html index.htm index.php;
    client_max_body_size 64M;

    location / {
        try_files $uri $uri/ =404;
    }
}
`;
}

export async function writeAndEnableNginxSite(
  siteName: string,
  content: string,
  dryRun: boolean
) {
  const available = path.join(SITES_AVAILABLE, siteName);
  const enabled = path.join(SITES_ENABLED, siteName);

  if (dryRun) {
    console.log(`[DRY RUN] write nginx site ${siteName}`);
    return { available, enabled };
  }

  await fs.mkdir(SITES_AVAILABLE, { recursive: true });
  await fs.mkdir(SITES_ENABLED, { recursive: true });
  await fs.mkdir(ACME_WEBROOT, { recursive: true });
  await fs.writeFile(available, content, "utf8");

  try {
    await fs.unlink(enabled);
  } catch {
    /* ignore */
  }
  await fs.symlink(available, enabled);

  await exec("nginx", ["-t"]);
  await exec("systemctl", ["reload", "nginx"]);
  return { available, enabled };
}

export async function removeNginxSite(siteName: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`[DRY RUN] remove nginx site ${siteName}`);
    return;
  }
  await fs.rm(path.join(SITES_ENABLED, siteName), { force: true });
  await fs.rm(path.join(SITES_AVAILABLE, siteName), { force: true });
  try {
    await exec("nginx", ["-t"]);
    await exec("systemctl", ["reload", "nginx"]);
  } catch {
    /* ignore reload errors on delete */
  }
}

export async function ensureDefaultIndex(documentRoot: string, domain: string) {
  await fs.mkdir(documentRoot, { recursive: true });
  const indexPath = path.join(documentRoot, "index.html");
  if (await fileExists(indexPath)) {
    const stat = await fs.stat(indexPath);
    if (stat.size > 0) return;
  }
  await fs.writeFile(
    indexPath,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${domain}</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0">
  <h1 style="margin:0 0 .5rem">${domain}</h1>
  <p style="color:#94a3b8">Hosted on Naviyra Panel. Upload your site files to replace this page.</p>
</body>
</html>
`,
    "utf8"
  );
}

export async function issueLetsEncrypt(
  domain: string,
  documentRoot: string,
  dryRun: boolean,
  extraLabels: string[] = []
): Promise<{ issuedAt: string; expiresAt: string; certDir: string }> {
  const hosts = expandSslHosts(domain, extraLabels);
  const certDir = `/etc/letsencrypt/live/${domain}`;
  const siteName = domain;

  if (dryRun) {
    const now = new Date();
    const expires = new Date(now);
    expires.setDate(expires.getDate() + 90);
    return {
      issuedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      certDir,
    };
  }

  await fs.mkdir(ACME_WEBROOT, { recursive: true });
  await ensureDefaultIndex(documentRoot, domain);

  // Ensure HTTP vhost exists for ACME challenge before requesting cert
  await writeAndEnableNginxSite(
    siteName,
    buildHttpVhost(hosts, documentRoot),
    false
  );

  const email =
    process.env.LETSENCRYPT_EMAIL?.trim() ||
    `admin@${domain.split(".").slice(-2).join(".")}`;

  const args = [
    "certonly",
    "--non-interactive",
    "--agree-tos",
    "--keep-until-expiring",
    "--cert-name",
    domain,
    "--webroot",
    "-w",
    ACME_WEBROOT,
    "--email",
    email,
    ...hosts.flatMap((h) => ["-d", h]),
  ];

  await exec("certbot", args);

  await writeAndEnableNginxSite(
    siteName,
    buildHttpsVhost(hosts, documentRoot, certDir),
    false
  );

  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + 90);
  return {
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    certDir,
  };
}
