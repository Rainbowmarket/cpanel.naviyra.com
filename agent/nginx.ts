/**
 * Linux nginx + Let's Encrypt helpers for Naviyra agent
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildPhpDenyBlock, buildPhpLocationBlock, resolvePhpFpmPass } from "./php-fpm";
import { sanitizeHostnameForPath } from "./hostname";
import { PROJECT_ROOT } from "./paths";

const exec = promisify(execFile);

const SITES_AVAILABLE = "/etc/nginx/sites-available";
const SITES_ENABLED = "/etc/nginx/sites-enabled";
const ACME_WEBROOT = "/var/www/certbot";
const NAVIYRA_VISITOR_LOG = "/var/log/nginx/naviyra-visitors.log";
const NAVIYRA_VISITORS_CONF = "/etc/nginx/conf.d/naviyra-visitors.conf";
const NAVIYRA_VISITORS_CONF_BODY = `log_format naviyra_visitors '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" "$http_user_agent" "$host"';
access_log ${NAVIYRA_VISITOR_LOG} naviyra_visitors;
`;

function stripVisitorLogFormat(text: string): string {
  return text
    .replace(/log_format\s+naviyra_visitors\b[\s\S]*?;/g, "")
    .replace(/[ \t]*access_log\s+\S+\s+naviyra_visitors\s*;[ \t]*\n?/g, "");
}

function visitorAccessLogLine(): string {
  return `    access_log ${NAVIYRA_VISITOR_LOG} naviyra_visitors;\n`;
}

export type VhostOptions = {
  phpEnabled?: boolean;
  /** Override auto-detected fastcgi_pass (unix:/path or 127.0.0.1:9000) */
  phpFpmPass?: string | null;
  /** React/Vite SPA: fallback unknown paths to /index.html */
  spaMode?: boolean;
  /** STATIC | PHP | PYTHON | GO | NODE */
  appType?: string;
  /** Local upstream for PYTHON/GO/NODE proxy apps */
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
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 10s;
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
${visitorAccessLogLine()}    client_max_body_size 64M;

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
${visitorAccessLogLine()}
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
${visitorAccessLogLine()}    ssl_certificate     ${certDir}/fullchain.pem;
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
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 10s;
        proxy_redirect off;
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
  if (options.appType === "PHP" || options.appType === "PYTHON" || options.appType === "GO" || options.appType === "NODE") {
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
${visitorAccessLogLine()}
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
${visitorAccessLogLine()}
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
${visitorAccessLogLine()}    ssl_certificate     ${certDir}/fullchain.pem;
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
  if (extras?.appType === "PYTHON" || extras?.appType === "GO" || extras?.appType === "NODE") {
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
  const safeName = sanitizeHostnameForPath(siteName);
  if (isPanelHostname(safeName)) {
    console.warn(
      `[nginx] Refusing to overwrite panel hostname vhost: ${safeName}`
    );
    return {
      available: path.join(SITES_AVAILABLE, safeName),
      enabled: path.join(SITES_ENABLED, safeName),
      skipped: true as const,
    };
  }

  const available = path.join(SITES_AVAILABLE, safeName);
  const enabled = path.join(SITES_ENABLED, safeName);

  if (dryRun) {
    console.log(`[DRY RUN] write nginx site ${safeName}`);
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

  await nginxTestAndReload();
  return { available, enabled };
}

async function nginxTestAndReload() {
  await ensureNaviyraVisitorLog();
  try {
    await exec("nginx", ["-t"]);
  } catch (err) {
    const execErr = err as { message?: string; stderr?: string; stdout?: string };
    const msg = `${execErr.message || ""} ${execErr.stderr || ""} ${execErr.stdout || ""}`;
    if (/duplicate/.test(msg) && /naviyra_visitors/.test(msg)) {
      await fs.writeFile(
        NAVIYRA_VISITORS_CONF,
        `access_log ${NAVIYRA_VISITOR_LOG} naviyra_visitors;\n`,
        "utf8"
      );
    } else {
      await restoreWebsocketMap();
      await fs.writeFile(NAVIYRA_VISITORS_CONF, NAVIYRA_VISITORS_CONF_BODY, "utf8");
    }
    await exec("nginx", ["-t"]);
  }
  await exec("systemctl", ["reload", "nginx"]);
}

async function restoreWebsocketMap() {
  const src = path.join(PROJECT_ROOT, "scripts", "nginx-websocket-map.conf");
  try {
    const body = await fs.readFile(src, "utf8");
    await fs.mkdir("/etc/nginx/conf.d", { recursive: true });
    await fs.writeFile("/etc/nginx/conf.d/naviyra-websocket-map.conf", body, "utf8");
  } catch {
    /* template optional */
  }
}

/** Combined+$host so Security Manager can attribute visits to a domain. */
export async function ensureNaviyraVisitorLog(): Promise<void> {
  if (process.platform === "win32") return;

  await restoreWebsocketMap();

  const main = "/etc/nginx/nginx.conf";
  try {
    const text = await fs.readFile(main, "utf8");
    let stripped = stripVisitorLogFormat(text);
    if (
      /^\s*http\s*\{/m.test(stripped) &&
      !/access_log\s+\/var\/log\/nginx\/access\.log/.test(stripped)
    ) {
      stripped = stripped.replace(
        /^(\s*)http\s*\{/m,
        (_all, indent: string) => `${indent}http {\n    access_log /var/log/nginx/access.log;`
      );
    }
    if (stripped !== text) await fs.writeFile(main, stripped, "utf8");
  } catch {
    /* nginx.conf optional */
  }

  try {
    await fs.mkdir("/etc/nginx/conf.d", { recursive: true });
    await fs.writeFile(NAVIYRA_VISITORS_CONF, NAVIYRA_VISITORS_CONF_BODY, "utf8");
  } catch {
    return;
  }

  try {
    await fs.writeFile(NAVIYRA_VISITOR_LOG, "", { flag: "a" });
  } catch {
    /* log dir may not exist yet */
  }

  const dirs = [SITES_AVAILABLE, "/etc/nginx/conf.d"];
  const seen = new Set<string>();
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === "naviyra-visitors.conf") continue;
      if (name.startsWith("naviyra-websocket")) continue;
      const file = path.join(dir, name);
      let stat: fsSync.Stats;
      try {
        stat = fsSync.statSync(file);
        if (!stat.isFile()) continue;
        const key = `${stat.dev}:${stat.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
      } catch {
        continue;
      }
      let text: string;
      try {
        text = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const next = injectVisitorAccessLog(text);
      if (next !== text) await fs.writeFile(file, next, "utf8");
    }
  }
}

function injectVisitorAccessLog(text: string): string {
  if (!/server\s*\{/.test(text)) return text;
  const parts = text.split(/(server\s*\{)/);
  let out = parts[0] ?? "";
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i] ?? "";
    const body = parts[i + 1] ?? "";
    out += header;
    const hasOwnLog = /^\s*access_log\s+/m.test(body);
    if (hasOwnLog && !body.includes("naviyra-visitors.log")) {
      out += `\n${visitorAccessLogLine()}${body}`;
    } else {
      out += body;
    }
  }
  return out;
}

export async function removeNginxSite(siteName: string, dryRun: boolean) {
  const safeName = sanitizeHostnameForPath(siteName);
  if (isPanelHostname(safeName)) {
    console.warn(
      `[nginx] Refusing to remove panel hostname vhost: ${safeName}`
    );
    return;
  }
  if (dryRun) {
    console.log(`[DRY RUN] remove nginx site ${safeName}`);
    return;
  }
  await fs.rm(path.join(SITES_ENABLED, safeName), { force: true });
  await fs.rm(path.join(SITES_AVAILABLE, safeName), { force: true });
  try {
    await nginxTestAndReload();
  } catch {
    /* ignore reload errors on delete */
  }
}

function buildMailPortalIndex(mailHost: string): string {
  const domainName = mailHost.replace(/^mail\./i, "");
  const panel =
    process.env.PANEL_PUBLIC_URL?.trim().replace(/\/$/, "") ||
    (domainName ? `https://${domainName}` : "");
  const webmailUrl = panel ? `${panel}/webmail` : "/webmail";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=${webmailUrl}" />
  <title>Webmail · ${domainName}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: system-ui,sans-serif; background:#0f172a; color:#e2e8f0;
      display:flex; min-height:100vh; align-items:center; justify-content:center; }
    a { color:#34d399; }
  </style>
</head>
<body>
  <p>Opening webmail… <a href="${webmailUrl}">Continue</a></p>
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
  const safeDomain = sanitizeHostnameForPath(domain);
  const hosts = expandSslHosts(safeDomain, extraLabels);
  const certDir = `/etc/letsencrypt/live/${safeDomain}`;
  const siteName = safeDomain;
  const vhostOpts = await resolveVhostOptions(phpEnabled, extras);
  const panelHost = isPanelHostname(safeDomain);

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

  // Control-panel host (e.g. hpanel.naviyra.uk) already has a reverse-proxy vhost.
  // Never replace that nginx config with a site document-root.
  if (!panelHost) {
    await ensureDefaultIndex(documentRoot, safeDomain);
    const httpConf = isMailHostname(safeDomain)
      ? buildMailProxyHttpVhost(hosts)
      : buildHttpVhost(hosts, documentRoot, vhostOpts);
    await writeAndEnableNginxSite(siteName, httpConf, false);
  }

  const email =
    process.env.LETSENCRYPT_EMAIL?.trim() ||
    `admin@${safeDomain.split(".").slice(-2).join(".")}`;

  const args = [
    "certonly",
    "--non-interactive",
    "--agree-tos",
    "--keep-until-expiring",
    "--cert-name",
    safeDomain,
    "--webroot",
    "-w",
    ACME_WEBROOT,
    "--email",
    email,
    ...hosts.flatMap((h) => ["-d", h]),
  ];

  await exec("certbot", args);

  if (!panelHost) {
    const httpsConf = isMailHostname(safeDomain)
      ? buildMailProxyHttpsVhost(hosts, certDir)
      : buildHttpsVhost(hosts, documentRoot, certDir, vhostOpts);
    await writeAndEnableNginxSite(siteName, httpsConf, false);
  }

  return readCertDates(certDir);
}

/** Read issued/expiry dates from an existing Let's Encrypt fullchain. */
export async function readCertDates(
  certDir: string
): Promise<{ issuedAt: string; expiresAt: string; certDir: string }> {
  const fullchain = path.join(certDir, "fullchain.pem");
  if (!(await fileExists(fullchain))) {
    throw new Error(`Certificate not found at ${fullchain}`);
  }
  const { stdout } = await exec("openssl", [
    "x509",
    "-in",
    fullchain,
    "-noout",
    "-dates",
  ]);
  const before = /notBefore=(.+)/.exec(stdout)?.[1]?.trim();
  const after = /notAfter=(.+)/.exec(stdout)?.[1]?.trim();
  const issuedAt = before ? new Date(before).toISOString() : new Date().toISOString();
  const expiresAt = after
    ? new Date(after).toISOString()
    : new Date(Date.now() + 90 * 864e5).toISOString();
  return { issuedAt, expiresAt, certDir };
}

export const NGINX_UPLOAD_HTTP_CONF = "/etc/nginx/conf.d/naviyra-upload.conf";
export const NGINX_UPLOAD_SNIPPET = "/etc/nginx/snippets/naviyra-upload-limit.conf";

function uploadLimitConfBody(maxMb: number): string {
  return `# Managed by Naviyra Panel (Admin → Settings)
client_max_body_size ${maxMb}M;
`;
}

function clampUploadMb(maxMb: number): number {
  if (!Number.isFinite(maxMb)) return 512;
  return Math.max(1, Math.min(2048, Math.floor(maxMb)));
}

/** http-level + snippet so File Manager is not stuck on nginx's default 1m. */
export async function applyNginxUploadLimit(options: {
  maxMb: number;
  dryRun?: boolean;
}): Promise<{ applied: boolean; maxMb: number; path: string; dryRun?: boolean }> {
  const maxMb = clampUploadMb(options.maxMb);
  const body = uploadLimitConfBody(maxMb);
  if (options.dryRun) {
    return { applied: false, maxMb, path: NGINX_UPLOAD_HTTP_CONF, dryRun: true };
  }
  if (process.platform === "win32") {
    return { applied: false, maxMb, path: NGINX_UPLOAD_HTTP_CONF, dryRun: true };
  }

  await fs.mkdir("/etc/nginx/conf.d", { recursive: true });
  await fs.mkdir("/etc/nginx/snippets", { recursive: true });

  const previousHttp = (await fileExists(NGINX_UPLOAD_HTTP_CONF))
    ? await fs.readFile(NGINX_UPLOAD_HTTP_CONF, "utf8")
    : "";
  const previousSnippet = (await fileExists(NGINX_UPLOAD_SNIPPET))
    ? await fs.readFile(NGINX_UPLOAD_SNIPPET, "utf8")
    : "";

  await fs.writeFile(NGINX_UPLOAD_HTTP_CONF, body, "utf8");
  await fs.writeFile(NGINX_UPLOAD_SNIPPET, body, "utf8");

  const vhostBackups = await syncVhostBodySize(maxMb);

  try {
    await exec("nginx", ["-t"]);
    await exec("systemctl", ["reload", "nginx"]);
  } catch (error) {
    await fs.writeFile(NGINX_UPLOAD_HTTP_CONF, previousHttp, "utf8");
    await fs.writeFile(NGINX_UPLOAD_SNIPPET, previousSnippet, "utf8");
    for (const [filePath, contents] of vhostBackups) {
      await fs.writeFile(filePath, contents, "utf8");
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`nginx rejected upload limit ${maxMb}M: ${message}`);
  }

  return { applied: true, maxMb, path: NGINX_UPLOAD_HTTP_CONF };
}

async function syncVhostBodySize(maxMb: number): Promise<Map<string, string>> {
  const backups = new Map<string, string>();
  const seen = new Set<string>();
  for (const dir of [SITES_AVAILABLE, SITES_ENABLED]) {
    if (!fsSync.existsSync(dir)) continue;
    const names = await fs.readdir(dir);
    for (const name of names) {
      const filePath = path.join(dir, name);
      let real = filePath;
      try {
        real = fsSync.realpathSync(filePath);
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      let text: string;
      try {
        text = await fs.readFile(real, "utf8");
      } catch {
        continue;
      }
      if (!/client_max_body_size\s+\S+;/.test(text)) continue;
      const next = text.replace(
        /client_max_body_size\s+\S+;/g,
        `client_max_body_size ${maxMb}M;`
      );
      if (next === text) continue;
      backups.set(real, text);
      await fs.writeFile(real, next, "utf8");
    }
  }
  return backups;
}
