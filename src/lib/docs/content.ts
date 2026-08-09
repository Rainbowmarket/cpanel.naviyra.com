export type DocSection = {
  heading: string;
  body?: string[];
  steps?: string[];
  tips?: string[];
};

export type DocArticle = {
  slug: string;
  title: string;
  summary: string;
  href: string;
  audience: "all" | "admin";
  category: "Getting started" | "Hosting" | "Services" | "Tools" | "Admin";
  sections: DocSection[];
};

export const DOC_ARTICLES: DocArticle[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "How the panel works, roles, and live vs dry-run mode.",
    href: "/dashboard",
    audience: "all",
    category: "Getting started",
    sections: [
      {
        heading: "What this panel does",
        body: [
          "Naviyra is a self-hosted hosting control panel. From the browser you manage domains, mail, FTP, SSL, DNS, files, databases, security, and app runtimes on the same server.",
          "The web UI talks to a local Server Agent that applies changes (nginx, certificates, systemd, PostgreSQL, and so on).",
        ],
      },
      {
        heading: "Roles",
        body: [
          "USER and RESELLER manage their own domains and related services.",
          "ADMIN can manage all users, backups, speed test, and Terminal (host shell).",
        ],
        tips: [
          "Live hosting changes need the agent running as root/Administrator with AGENT_DRY_RUN=false.",
          "On Windows, dry-run is the default for safe testing.",
        ],
      },
      {
        heading: "Typical workflow",
        steps: [
          "Add a domain (and optional subdomains).",
          "Choose a runtime: Static, PHP, Node.js, Python, or Go.",
          "Upload site files in File Manager (ZIP extracts automatically).",
          "Issue SSL, create mail/FTP/database accounts as needed.",
          "Use Security and Backups to monitor and protect the server.",
          "Watch live CPU and RAM on Overview (Server load).",
        ],
      },
    ],
  },
  {
    slug: "domains",
    title: "Domains",
    summary: "Add a domain, set document root, and pick an app runtime.",
    href: "/dashboard/domains",
    audience: "all",
    category: "Hosting",
    sections: [
      {
        heading: "How to add a domain",
        steps: [
          "Open Hosting → Domains.",
          "Click Add domain and enter the hostname (example.com).",
          "Choose the app type: Static / PHP / Node.js / Python / Go.",
          "Save. The panel creates the document root and nginx vhost.",
        ],
      },
      {
        heading: "How to use it",
        body: [
          "Point the domain’s DNS A record (and www if used) to this server’s public IP.",
          "Upload files into the domain’s public_html (or configured root) via File Manager or FTP.",
          "Use Runtime on the domain row to change app type, application root / startup file, and Start / Stop / Restart for Node/Python/Go.",
        ],
        tips: [
          "Issue SSL after DNS points here so Let’s Encrypt can validate.",
          "Node/Python/Go apps listen on a localhost port (12000–12999); nginx reverse-proxies the site.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "SPA/static sites get index.html fallback for client-side routes.",
          "PHP uses PHP-FPM with a front controller.",
          "Proxy apps (Node/Python/Go) support WebSockets (wss://) on the same hostname.",
        ],
      },
    ],
  },
  {
    slug: "subdomains",
    title: "Subdomains",
    summary: "Create hosts like app.example.com under an existing domain.",
    href: "/dashboard/subdomains",
    audience: "all",
    category: "Hosting",
    sections: [
      {
        heading: "How to add a subdomain",
        steps: [
          "Open Hosting → Subdomains.",
          "Select the parent domain and enter the label (e.g. blog).",
          "Choose runtime (Static / PHP / Node.js / Python / Go) and create.",
        ],
      },
      {
        heading: "How to use it",
        body: [
          "DNS for name.domain should resolve to this server (often via the panel’s DNS zone).",
          "Each subdomain has its own document root and optional runtime controls.",
        ],
        tips: [
          "Mail hostnames like mail.example.com are special — they proxy to webmail and should not be replaced with a normal site vhost.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Same runtime options as domains, including WebSocket-capable proxy apps.",
          "Deleting a subdomain can optionally remove its folder on disk.",
        ],
      },
    ],
  },
  {
    slug: "app-runtimes",
    title: "App runtimes",
    summary: "Static, PHP, Node.js, Python, and Go — how to configure and run them.",
    href: "/dashboard/domains",
    audience: "all",
    category: "Hosting",
    sections: [
      {
        heading: "How to configure",
        steps: [
          "On Domains or Subdomains, open Runtime for the site.",
          "Pick Static, PHP, Node.js, Python, or Go.",
          "For Node/Python/Go: set Application mode (Development/Production), Application root (folder under the site document root), and Application startup file (e.g. server.js). Optionally override the start command under Advanced.",
          "Click Save, then Start (or Restart) so systemd runs the process.",
        ],
      },
      {
        heading: "How to execute / run",
        body: [
          "Static: upload a built SPA or HTML site; nginx serves files.",
          "PHP: upload PHP app; ensure index.php / front controller is present.",
          "Node: upload app under Application root; startup file like server.js → runs as node server.js with PORT/HOST set. Uses system Node.js (install-runtimes.sh).",
          "Python example: startup file app.py, or advanced command python3 -m uvicorn main:app --host 127.0.0.1 --port $PORT",
          "Go: upload a compiled binary; startup file app or start command ./app (must bind 127.0.0.1:$PORT).",
        ],
        tips: [
          "Ports are allocated in 12000–12999 and stay on localhost only.",
          "Install server runtimes once: sudo bash scripts/install-runtimes.sh",
          "Application root is relative to the site document root (use . for the site root, or api / backend for a subfolder).",
        ],
      },
      {
        heading: "Specialties — WebSockets",
        body: [
          "Node/Python/Go proxy apps support browser WebSockets automatically via nginx.",
          "See the dedicated Docs article: WebSockets — step-by-step setup and client examples.",
        ],
      },
    ],
  },
  {
    slug: "websockets",
    title: "WebSockets",
    summary:
      "Enable wss:// on customer sites — proxy app setup, client URL, and examples.",
    href: "/dashboard/domains",
    audience: "all",
    category: "Hosting",
    sections: [
      {
        heading: "What is supported",
        body: [
          "Customer sites that run as a reverse-proxied app (Node, Python, or Go runtime with an upstream port) accept WebSocket upgrades from the browser.",
          "Nginx forwards Upgrade / Connection correctly and keeps the connection open up to about one hour (proxy_read_timeout / proxy_send_timeout).",
          "Static HTML/SPA and plain PHP document-root sites are NOT reverse-proxied — they cannot terminate WebSockets by themselves. Put your WS backend on a Node/Python/Go domain or subdomain instead.",
        ],
      },
      {
        heading: "How to add (panel setup)",
        steps: [
          "Create a Domain or Subdomain (e.g. api.example.com or app.example.com).",
          "Open Runtime and set App type to Node.js, Python, or Go.",
          "Set Application root and startup file (or an advanced start command that binds 127.0.0.1 and uses $PORT).",
          "Upload your app files into that site’s document root / application root (File Manager or FTP).",
          "Click Save, then Start (or Restart).",
          "Issue SSL for the hostname so browsers can use wss:// (not insecure ws:// on HTTPS pages).",
        ],
      },
      {
        heading: "How to execute (run your app)",
        body: [
          "Node: startup file server.js (or index.js) — listen on process.env.PORT and 127.0.0.1 / HOST.",
          "Python (FastAPI / Uvicorn example): python3 -m uvicorn main:app --host 127.0.0.1 --port $PORT",
          "Python (Socket.IO / other ASGI): same idea — listen on 127.0.0.1:$PORT.",
          "Go: compile a binary that listens on 127.0.0.1 and the PORT env (or $PORT in the start command), e.g. ./server",
        ],
        tips: [
          "The panel allocates a port in 12000–12999 and injects it as $PORT / PORT for the systemd unit.",
          "Never bind 0.0.0.0 publicly for the app — nginx is the public entry; the app stays on localhost.",
        ],
      },
      {
        heading: "How the browser connects",
        body: [
          "Use the same public hostname as the site, with the wss: scheme when the site has HTTPS.",
          "Example: wss://api.example.com/ws   or   wss://app.example.com/socket.io/?EIO=4&transport=websocket",
          "Path must match what your app registers (e.g. /ws, /socket.io/, /chat).",
          "Do not connect to wss://127.0.0.1:12xxx from the browser — that port is localhost-only on the server.",
        ],
        steps: [
          "Confirm the site opens over https://your-host in the browser.",
          "In app/frontend code, open: new WebSocket(\"wss://your-host/your-path\")",
          "For Socket.IO: io(\"https://your-host\", { path: \"/socket.io\", transports: [\"websocket\"] })",
          "Watch the browser Network tab — the request should show status 101 Switching Protocols.",
        ],
      },
      {
        heading: "Minimal client example",
        body: [
          "JavaScript: const ws = new WebSocket(\"wss://api.example.com/ws\"); ws.onopen = () => ws.send(\"hello\"); ws.onmessage = (e) => console.log(e.data);",
          "Your server must accept the HTTP Upgrade on that path and speak the WebSocket protocol (libraries: ws, Socket.IO, FastAPI WebSocket, gorilla/websocket, etc.).",
        ],
      },
      {
        heading: "Specialties & checks",
        body: [
          "Nginx uses map $http_upgrade $connection_upgrade (installed as /etc/nginx/conf.d/naviyra-websocket-map.conf).",
          "New proxy vhosts get Upgrade headers automatically; deploy refreshes existing ones via scripts/install-websocket-map.sh.",
          "Panel Terminal WebSockets (wss://panel/terminal-ws/…) are separate — that is for the admin shell, not customer apps.",
        ],
        tips: [
          "If WS fails: ensure Runtime is Node/Python/Go and the unit is Started; ensure SSL is active; ensure your app handles the path; check agent/nginx logs.",
          "Mixed content: an https:// page cannot open ws:// — use wss://.",
        ],
      },
    ],
  },
  {
    slug: "mail",
    title: "Mail",
    summary: "Create mailboxes, manage passwords, and use webmail.",
    href: "/dashboard/mail",
    audience: "all",
    category: "Services",
    sections: [
      {
        heading: "How to add a mailbox",
        steps: [
          "Open Services → Mail.",
          "Select the domain and create an account (local part + password).",
          "Optional: set quota and activate/deactivate accounts later.",
        ],
      },
      {
        heading: "How to use it",
        body: [
          "Webmail: visit mail.yourdomain (when provisioned) or use the panel mailbox UI.",
          "External clients: use IMAP/SMTP with the server hostname and the mailbox password.",
          "Password reset and lockouts after failed webmail logins are managed in the panel.",
        ],
        tips: [
          "MAIL_FROM / SPF must allow this server IP for outbound system mail (password reset).",
          "Public DNS for mail.* should point at SERVER_PUBLIC_IP.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Virtual mailboxes with Postfix/Dovecot-style layout under the mail vhosts dir.",
          "mail.* hosts reverse-proxy to the panel webmail login.",
        ],
      },
    ],
  },
  {
    slug: "ftp",
    title: "FTP",
    summary: "Create FTP users jailed to a domain document root.",
    href: "/dashboard/ftp",
    audience: "all",
    category: "Services",
    sections: [
      {
        heading: "How to add an FTP account",
        steps: [
          "Open Services → FTP.",
          "Choose the domain/target and set username + password.",
          "Create — the home directory is tied to that site’s files.",
        ],
      },
      {
        heading: "How to connect",
        body: [
          "Host: your server IP or hostname.",
          "Port: 21 (passive mode supported).",
          "Login with the FTP username and password from the panel.",
        ],
        tips: [
          "Prefer SFTP/SSH or File Manager when possible; FTP sends credentials less securely unless FTPS is configured at the OS level.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Uses vsftpd on Linux installs.",
          "Accounts are scoped per domain home directory.",
        ],
      },
    ],
  },
  {
    slug: "databases",
    title: "Databases (PostgreSQL)",
    summary: "Create customer PostgreSQL databases, browse schema, and edit tables.",
    href: "/dashboard/databases",
    audience: "all",
    category: "Services",
    sections: [
      {
        heading: "How to add a database",
        steps: [
          "Open Services → Databases.",
          "Select the owning domain/target.",
          "Create database — the panel provisions DB name, role, and password (localhost only).",
        ],
      },
      {
        heading: "How to use it",
        body: [
          "Copy connection details (host 127.0.0.1, port often 5433 if 5432 is busy).",
          "Use Schema browser to inspect tables and preview rows.",
          "Create / edit / delete tables via the UI (real DDL on the server).",
        ],
        tips: [
          "Customer DBs are not exposed on the public internet by default — connect from apps on this server or via SSH tunnel.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Panel itself uses SQLite; customer DBs use host PostgreSQL.",
          "Backups can include PostgreSQL dumps when enabled.",
        ],
      },
    ],
  },
  {
    slug: "ssl",
    title: "SSL certificates",
    summary: "Issue and renew Let’s Encrypt certificates for your hosts.",
    href: "/dashboard/ssl",
    audience: "all",
    category: "Services",
    sections: [
      {
        heading: "How to issue SSL",
        steps: [
          "Ensure DNS for the domain (and www if included) points to this server.",
          "Open Services → SSL.",
          "Select the domain and Issue / Renew.",
        ],
      },
      {
        heading: "How it runs",
        body: [
          "Certbot validates HTTP-01 via nginx, then the panel writes the HTTPS vhost.",
          "Renew from the same screen when certificates are near expiry.",
        ],
        tips: [
          "Set LETSENCRYPT_EMAIL in .env for expiry notices.",
          "Cloudflare orange-cloud can block HTTP-01 — use DNS-only during issue, or ensure ACME challenge paths work.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Supports apex + www expansion where configured.",
          "mail.* and other hosts can be covered when included in SSL flows / proxies.",
        ],
      },
    ],
  },
  {
    slug: "dns",
    title: "DNS",
    summary: "Manage zone records and sync to BIND on this server.",
    href: "/dashboard/dns",
    audience: "all",
    category: "Services",
    sections: [
      {
        heading: "How to add / edit records",
        steps: [
          "Open Services → DNS.",
          "Select the domain zone.",
          "Add or edit A, AAAA, CNAME, MX, TXT, NS, and related records.",
          "Save — the agent syncs zone files and reloads BIND when installed.",
        ],
      },
      {
        heading: "How to use it",
        body: [
          "Delegate the domain’s NS to this server’s nameservers (e.g. ns1/ns2.yourpanel) at the registrar, or copy records into Cloudflare/another DNS host.",
          "SERVER_PUBLIC_IP is used for default A records.",
        ],
        tips: [
          "If DNS lives only at Cloudflare, still add matching A/TXT there for mail and SSL.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Zones live under the panel data DNS tree and BIND include dirs on Linux.",
          "Domain/subdomain create often seeds baseline records automatically.",
        ],
      },
    ],
  },
  {
    slug: "file-manager",
    title: "File Manager",
    summary: "Browse, edit, upload, extract ZIP, and manage site files.",
    href: "/dashboard/files",
    audience: "all",
    category: "Tools",
    sections: [
      {
        heading: "How to open files",
        steps: [
          "Open Tools → File Manager (or Files).",
          "Pick the domain/subdomain target.",
          "Navigate folders; open a file to edit in the built-in editor.",
        ],
      },
      {
        heading: "How to upload and extract",
        body: [
          "Use Upload — drop files or click to choose.",
          "Progress shows percent, transferred size, speed (KB/s or MB/s), and ETA.",
          "ZIP uploads are extracted automatically into the target folder.",
        ],
        tips: [
          "Large uploads (tens of MB+) are supported after the panel body-size / binary agent upload fixes.",
          "Multi-select supports copy, move, and delete operations.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Sensitive paths are denied at nginx for public sites.",
          "Folder ZIP download may still be unavailable (501) — download files individually or via backup for now.",
        ],
      },
    ],
  },
  {
    slug: "security",
    title: "Security",
    summary: "Visitors, threats, IP block list, and whitelist.",
    href: "/dashboard/security",
    audience: "all",
    category: "Tools",
    sections: [
      {
        heading: "How to use Security Manager",
        steps: [
          "Open Tools → Security.",
          "Review Visitors, Threats, Blocked, and Whitelist tabs.",
          "Administrators can block/unblock IPs and manage the whitelist; other roles can view.",
        ],
      },
      {
        heading: "How blocking works",
        body: [
          "Blocked IPs are enforced for site traffic via the security stack.",
          "Auto-blocks can expire after AUTO_BLOCK_TTL_HOURS; manual blocks stay until removed.",
          "Whitelist entries bypass blocking for trusted IPs.",
          "Manual block/whitelist changes and “Block” from a threat event require ADMIN.",
        ],
        tips: [
          "Visitor ingest uses a secure ingest key from nginx/log parsers when configured.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Overview cards on the dashboard link into security tabs.",
          "Expire-auto-blocks timer runs on Linux installs.",
        ],
      },
    ],
  },
  {
    slug: "two-factor",
    title: "Two-factor authentication (2FA)",
    summary: "Protect panel login with an authenticator app and backup codes.",
    href: "/dashboard/account",
    audience: "all",
    category: "Getting started",
    sections: [
      {
        heading: "How to enable",
        steps: [
          "Open Main → Account security.",
          "Click Enable 2FA and scan the QR code with Google Authenticator, Authy, or 1Password.",
          "Enter a 6-digit code to confirm.",
          "Save the backup codes offline — they are shown only once.",
        ],
      },
      {
        heading: "How login works",
        body: [
          "After your password, the panel asks for a TOTP code (or an unused backup code).",
          "Disable 2FA anytime from Account security by re-entering your password.",
        ],
        tips: [
          "Production needs TWO_FACTOR_ENC_KEY in .env (openssl rand -hex 32).",
        ],
      },
    ],
  },
  {
    slug: "terminal",
    title: "Terminal",
    summary: "Admin-only web shell with session log (full server privileges).",
    href: "/dashboard/terminal",
    audience: "admin",
    category: "Admin",
    sections: [
      {
        heading: "How to start a session",
        steps: [
          "Open Admin → Terminal (administrators only).",
          "Connect to server root or a selected document root.",
        ],
      },
      {
        heading: "How to use it",
        body: [
          "Type shell commands in the xterm UI; resize is supported.",
          "Command history is logged for the session in the panel.",
        ],
        tips: [
          "Needs AGENT_DRY_RUN=false and a live PTY (root/admin on Linux).",
          "Production uses wss://panel-host/terminal-ws/terminal behind nginx.",
        ],
      },
      {
        heading: "Specialties — important",
        body: [
          "Non-admin Terminal was removed: prior “jail” mode was not OS containment.",
          "Sessions run with the agent process privileges — treat as full host access.",
        ],
      },
    ],
  },
  {
    slug: "backups",
    title: "Backups",
    summary: "Schedule, run, restore, and retain server/domain backups (admin).",
    href: "/dashboard/backups",
    audience: "admin",
    category: "Admin",
    sections: [
      {
        heading: "How to configure",
        steps: [
          "Open Admin → Backups.",
          "Enable the worker, choose schedule and retain count.",
          "Toggle what to include: panel DB, sites, DNS, mail, databases.",
          "Save — ensure the systemd backup timer is installed on the server.",
        ],
      },
      {
        heading: "How to run and restore",
        body: [
          "Run all-domain or single-domain backup from the UI.",
          "Restore from a listed archive (sites / DB / mail parts as selected).",
          "Delete old runs to free disk under the backup root.",
        ],
        tips: [
          "Backup worker can authenticate with BACKUP_WORKER_TOKEN or AGENT_API_KEY.",
          "Archives are stored under the configured backupRoot (often data/backups).",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Includes PostgreSQL customer DB dumps when includeDatabases is on.",
          "Domain-level archives for single-site restore.",
        ],
      },
    ],
  },
  {
    slug: "users",
    title: "Users",
    summary: "Create panel users and assign roles (admin).",
    href: "/dashboard/users",
    audience: "admin",
    category: "Admin",
    sections: [
      {
        heading: "How to add a user",
        steps: [
          "Open Admin → Users.",
          "Create user with name, email, password, and role (USER / RESELLER / ADMIN).",
          "They can log in at /login and manage their own resources.",
        ],
      },
      {
        heading: "How to manage",
        body: [
          "Reset passwords, change roles, or delete users from the same page.",
          "Deleting a user removes their domains and related records (cascade).",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "First-time setup can create the initial admin via /login/setup when no users exist.",
          "Forgot-password flow uses system mail (MAIL_FROM) when configured.",
        ],
      },
    ],
  },
  {
    slug: "speed-test",
    title: "Network Speed Test",
    summary: "Measure download/upload from the server (not your browser).",
    href: "/dashboard/speed-test",
    audience: "admin",
    category: "Admin",
    sections: [
      {
        heading: "How to run",
        steps: [
          "Open Admin → Speed Test.",
          "Optionally enable Download and/or Upload.",
          "Click Run speed test and wait 10–30 seconds.",
        ],
      },
      {
        heading: "How to read results",
        body: [
          "Headline Mbps is the best successful probe.",
          "Details list each mirror (Cloudflare, Cachefly, OVH) with MB/s and errors if a mirror is unreachable.",
        ],
        tips: [
          "This measures server uplink/downlink to public endpoints — not File Manager upload from your PC.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Admin-only.",
          "Failed mirrors (DNS/blocked) do not invalidate strong results from other providers.",
        ],
      },
    ],
  },
  {
    slug: "server-load",
    title: "Server load (CPU & RAM)",
    summary: "Watch live CPU and memory on the Overview dashboard.",
    href: "/dashboard",
    audience: "all",
    category: "Tools",
    sections: [
      {
        heading: "How to watch",
        steps: [
          "Open Overview (Dashboard).",
          "Find Server load above Storage.",
          "Leave Watching on to refresh about every 3 seconds, or Pause / Refresh manually.",
        ],
      },
      {
        heading: "How to read it",
        body: [
          "CPU % is sampled over a short interval across all cores.",
          "RAM shows used / available / total (Linux uses MemAvailable when present).",
          "Load averages (1 / 5 / 15 min) appear on Linux next to core count.",
          "Amber ≈ 75%+, red ≈ 90%+ — consider optimizing apps or upgrading the VPS.",
        ],
      },
      {
        heading: "Specialties",
        body: [
          "Requires a logged-in session (/api/system/resources).",
          "Polling pauses when the browser tab is hidden.",
        ],
      },
    ],
  },
];

export function getDocBySlug(slug: string): DocArticle | undefined {
  return DOC_ARTICLES.find((a) => a.slug === slug);
}

export function docsByCategory(
  role?: string
): Array<{ category: DocArticle["category"]; articles: DocArticle[] }> {
  const isAdmin = role === "ADMIN";
  const visible = DOC_ARTICLES.filter(
    (a) => a.audience === "all" || isAdmin
  );
  const order: DocArticle["category"][] = [
    "Getting started",
    "Hosting",
    "Services",
    "Tools",
    "Admin",
  ];
  return order
    .map((category) => ({
      category,
      articles: visible.filter((a) => a.category === category),
    }))
    .filter((g) => g.articles.length > 0);
}
