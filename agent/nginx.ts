/**
 * Linux nginx + Let's Encrypt helpers for Naviyra agent
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildPhpDenyBlock, buildPhpLocationBlock, resolvePhpFpmPass } from "./php-fpm";

const exec = promisify(execFile);

const SITES_AVAILABLE = "/etc/nginx/sites-available";
const SITES_ENABLED = "/etc/nginx/sites-enabled";
const ACME_WEBROOT = "/var/www/certbot";

export type VhostOptions = {
  phpEnabled?: boolean;
  /** Override auto-detected fastcgi_pass (unix:/path or 127.0.0.1:9000) */
  phpFpmPass?: string | null;
  /** React/Vite SPA: fallback unknown paths to /index.html */
  spaMode?: boolean;
  /** STATIC | PHP | PYTHON | GO */
  appType?: string;
  /** Local upstream for PYTHON/GO proxy apps */
  upstreamPort?: number | null;
};

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

function panelUpstream(): string {
  const port = process.env.PANEL_PORT?.trim() || "3100";
  return `http://127.0.0.1:${port}`;
}

export function isMailHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (/^mail\./i.test(h)) return true;

  const template = (process.env.MAIL_HOSTNAME ?? "mail.{domain}").trim().toLowerCase();
  if (!template.includes("{domain}")) {
    return h === template.replace(/\.$/, "");
  }
  const prefix = template.split("{domain}")[0]?.replace(/\.$/, "") ?? "mail";
  if (prefix) return h.startsWith(`${prefix}.`);
  return false;
}

function proxyPassBlock(): string {
  const upstream = panelUpstream();
  return `    location / {
        proxy_pass ${upstream};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
`;
}

/** mail.* hosts reverse-proxy to Naviyra panel webmail login. */
export function buildMailProxyHttpVhost(hosts: string[]): string {
  const serverName = hosts.join(" ");
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverName};
    client_max_body_size 64M;

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type text/plain;
    }

${proxyPassBlock()}}
`;
}

export function buildMailProxyHttpsVhost(
  hosts: string[],
  certDir: string
): string {
  const serverName = hosts.join(" ");
  const dhParam = `/etc/letsencrypt/ssl-dhparams.pem`;
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
    ssl_dhparam ${dhParam};

    client_max_body_size 64M;

${proxyPassBlock()}}
`;
}

function sensitiveDenyInclude(): string {
  return `    include /etc/nginx/snippets/naviyra-deny-sensitive.conf;
`;
}

function errorPagesInclude(): string {
  return `    include /etc/nginx/snippets/naviyra-error-pages.conf;
`;
}

function appProxyLocationBlock(port: number): string {
  const upstream = `http://127.0.0.1:${port}`;
  return `    location / {
        proxy_pass ${upstream};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
    }
`;
}

/**
 * SPA (React/Vite/etc.) needs fallback to index.html so client routes
 * like /login survive a browser reload. PHP apps keep the front-controller.
 */
function rootLocationBlock(
  phpEnabled: boolean,
  spaMode = false,
  upstreamPort?: number | null
): string {
  if (upstreamPort && upstreamPort > 0) {
    return appProxyLocationBlock(upstreamPort);
  }
  if (spaMode) {
    return `    location / {
        try_files $uri $uri/ /index.html;
    }
`;
  }
  if (phpEnabled) {
    return `    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
`;
  }
  return `    location / {
        try_files $uri $uri/ /index.html;
    }
`;
}

/** Detect React/Vite-style SPA document roots (vs PHP apps). */
export function detectSpaMode(documentRoot: string): boolean {
  try {
    const indexHtml = path.join(documentRoot, "index.html");
    if (!fsSync.existsSync(indexHtml)) return false;
    const indexPhp = path.join(documentRoot, "index.php");
    if (!fsSync.existsSync(indexPhp)) return true;
    const htaccess = path.join(documentRoot, ".htaccess");
    if (fsSync.existsSync(htaccess)) {
      const text = fsSync.readFileSync(htaccess, "utf8");
      if (/RewriteRule\s+\^\s+index\.html/i.test(text) || /SPA fallback/i.test(text)) {
        return true;
      }
    }
    const assetsDir = path.join(documentRoot, "assets");
    if (fsSync.existsSync(assetsDir) && fsSync.statSync(assetsDir).isDirectory()) {
      const files = fsSync.readdirSync(assetsDir);
      if (files.some((f) => /\.(js|css)$/i.test(f))) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function phpBlockForOptions(options: VhostOptions): string {
  if (options.upstreamPort && options.upstreamPort > 0) {
    // Proxy apps do not serve PHP from the same location /
    return buildPhpDenyBlock();
  }
  if (options.phpEnabled && options.phpFpmPass) {
    return buildPhpLocationBlock(options.phpFpmPass);
  }
  // Never serve raw .php as a downloadable static file.
  return buildPhpDenyBlock();
}

function resolveSpaMode(documentRoot: string, options: VhostOptions): boolean {
  if (options.appType === "STATIC") return true;
  if (options.appType === "PHP" || options.appType === "PYTHON" || options.appType === "GO") {
    return false;
  }
  if (options.spaMode != null) return Boolean(options.spaMode);
  return detectSpaMode(documentRoot);
}

export function buildHttpVhost(
  hosts: string[],
  documentRoot: string,
  options: VhostOptions = {}
): string {
  const upstreamPort =
    options.upstreamPort && options.upstreamPort > 0 ? options.upstreamPort : null;
  const phpEnabled =
    !upstreamPort && Boolean(options.phpEnabled && options.phpFpmPass);
  const spaMode = !upstreamPort && resolveSpaMode(documentRoot, options);
  const serverName = hosts.join(" ");
  const phpBlock = phpBlockForOptions(options);
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverName};

    root ${documentRoot};
    ${indexDirective(phpEnabled)}
    client_max_body_size 64M;

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
        default_type text/plain;
    }

${sensitiveDenyInclude()}${errorPagesInclude()}${rootLocationBlock(phpEnabled, spaMode, upstreamPort)}${phpBlock}}
`;
}

export function buildHttpsVhost(
  hosts: string[],
  documentRoot: string,
  certDir: string,
  options: VhostOptions = {}
): string {
  const upstreamPort =
    options.upstreamPort && options.upstreamPort > 0 ? options.upstreamPort : null;
  const phpEnabled =
    !upstreamPort && Boolean(options.phpEnabled && options.phpFpmPass);
  const spaMode = !upstreamPort && resolveSpaMode(documentRoot, options);
  const serverName = hosts.join(" ");
  const phpBlock = phpBlockForOptions(options);
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
    ${indexDirective(phpEnabled)}
    client_max_body_size 64M;

${sensitiveDenyInclude()}${errorPagesInclude()}${rootLocationBlock(phpEnabled, spaMode, upstreamPort)}${phpBlock}}
`;
}

function indexDirective(phpEnabled: boolean): string {
  return phpEnabled
    ? "index index.html index.htm index.php;"
    : "index index.html index.htm;";
}

/** Resolve FPM pass when PHP is requested; warn via console if missing. */
export async function resolveVhostOptions(
  phpEnabled?: boolean,
  extras?: Partial<VhostOptions>
): Promise<VhostOptions> {
  const base: VhostOptions = { ...(extras ?? {}) };
  const wantPhp =
    extras?.appType === "PHP" ||
    (extras?.appType == null && phpEnabled !== false && !extras?.upstreamPort);

  if (extras?.appType === "STATIC") {
    return { ...base, phpEnabled: false, phpFpmPass: null, spaMode: true, appType: "STATIC" };
  }
  if (extras?.appType === "PYTHON" || extras?.appType === "GO") {
    return {
      ...base,
      phpEnabled: false,
      phpFpmPass: null,
      spaMode: false,
      appType: extras.appType,
      upstreamPort: extras.upstreamPort ?? null,
    };
  }

  if (!wantPhp && !phpEnabled) {
    return { ...base, phpEnabled: false, phpFpmPass: null };
  }

  const phpFpmPass = await resolvePhpFpmPass();
  if (!phpFpmPass) {
    console.warn(
      "[nginx] phpEnabled but no PHP-FPM socket found — install php-fpm or set PHP_FPM_SOCKET"
    );
    return { ...base, phpEnabled: true, phpFpmPass: null, appType: extras?.appType ?? "PHP" };
  }
  return {
    ...base,
    phpEnabled: true,
    phpFpmPass,
    appType: extras?.appType ?? "PHP",
  };
}

function panelHostnames(): Set<string> {
  const hosts = new Set<string>();
  const add = (raw?: string | null) => {
    if (!raw?.trim()) return;
    let h = raw.trim().toLowerCase();
    h = h.replace(/^https?:\/\//, "").split("/")[0] ?? h;
    h = h.split(":")[0] ?? h;
    h = h.replace(/^www\./, "");
    if (!h) return;
    hosts.add(h);
    hosts.add(`www.${h}`);
  };

  add(process.env.PANEL_HOSTNAME);
  try {
    if (process.env.PANEL_PUBLIC_URL?.trim()) {
      add(new URL(process.env.PANEL_PUBLIC_URL.trim()).hostname);
    }
  } catch {
    /* ignore */
  }
  const serverHost = process.env.DEFAULT_SERVER_HOSTNAME?.trim();
  if (serverHost) {
    add(serverHost.replace(/^server\d+\./i, ""));
  }
  const ns1 = process.env.DNS_NS1?.trim();
  if (ns1) {
    add(ns1.replace(/^ns\d+\./i, ""));
  }
  return hosts;
}

export function isPanelHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  const hosts = panelHostnames();
  return hosts.has(h) || hosts.has(h.replace(/^www\./, ""));
}

export async function writeAndEnableNginxSite(
  siteName: string,
  content: string,
  dryRun: boolean
) {
  if (isPanelHostname(siteName)) {
    console.warn(
      `[nginx] Refusing to overwrite panel hostname vhost: ${siteName}`
    );
    return {
      available: path.join(SITES_AVAILABLE, siteName),
      enabled: path.join(SITES_ENABLED, siteName),
      skipped: true as const,
    };
  }

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
  if (isPanelHostname(siteName)) {
    console.warn(
      `[nginx] Refusing to remove panel hostname vhost: ${siteName}`
    );
    return;
  }
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

function buildMailPortalIndex(mailHost: string): string {
  const domainName = mailHost.replace(/^mail\./i, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=/webmail" />
  <title>Webmail · ${domainName}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: system-ui,sans-serif; background:#0f172a; color:#e2e8f0;
      display:flex; min-height:100vh; align-items:center; justify-content:center; }
    a { color:#34d399; }
  </style>
</head>
<body>
  <p>Opening webmail… <a href="/webmail">Continue</a></p>
</body>
</html>
`;
}

const STUB_INDEX_MARKERS = [
  "Mailbox host is live",
  "Hosted on Naviyra Panel. Upload your site files",
  "Naviyra mail host for",
];

export async function ensureDefaultIndex(documentRoot: string, domain: string) {
  await fs.mkdir(documentRoot, { recursive: true });
  const indexPath = path.join(documentRoot, "index.html");
  const mailHost = isMailHostname(domain);

  if (await fileExists(indexPath)) {
    const existing = await fs.readFile(indexPath, "utf8");
    const isManagedStub =
      existing.trim().length === 0 ||
      STUB_INDEX_MARKERS.some((m) => existing.includes(m));
    // Never overwrite a custom site upload.
    if (!isManagedStub) return;
    // Keep ordinary domain stubs; only refresh mail.* portal pages.
    if (!mailHost) return;
  }

  const html = mailHost
    ? buildMailPortalIndex(domain)
    : `<!doctype html>
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
`;
  await fs.writeFile(indexPath, html, "utf8");
}

export async function issueLetsEncrypt(
  domain: string,
  documentRoot: string,
  dryRun: boolean,
  extraLabels: string[] = [],
  phpEnabled = true,
  extras?: Partial<VhostOptions>
): Promise<{ issuedAt: string; expiresAt: string; certDir: string }> {
  const hosts = expandSslHosts(domain, extraLabels);
  const certDir = `/etc/letsencrypt/live/${domain}`;
  const siteName = domain;
  const vhostOpts = await resolveVhostOptions(phpEnabled, extras);

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

  const httpConf = isMailHostname(domain)
    ? buildMailProxyHttpVhost(hosts)
    : buildHttpVhost(hosts, documentRoot, vhostOpts);

  // Ensure HTTP vhost exists for ACME challenge before requesting cert
  await writeAndEnableNginxSite(siteName, httpConf, false);

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

  const httpsConf = isMailHostname(domain)
    ? buildMailProxyHttpsVhost(hosts, certDir)
    : buildHttpsVhost(hosts, documentRoot, certDir, vhostOpts);

  await writeAndEnableNginxSite(siteName, httpsConf, false);

  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + 90);
  return {
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    certDir,
  };
}
