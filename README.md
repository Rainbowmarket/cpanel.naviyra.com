# Naviyra Panel

A self-hosted hosting control panel (cPanel alternative). **Runs like software on Windows and Linux** — start once, control everything in your web browser.

Works on **Windows**, **Linux**, and **macOS**.

## Features

- **Domains** — add/remove domains, document roots
- **App runtimes** — React/static SPA, PHP-FPM, managed Python & Go (systemd + reverse proxy)
- **Subdomains** — create subdomains under any domain
- **Mail server** — email accounts per domain
- **FTP server** — FTP accounts per domain
- **SSL certificates** — Let's Encrypt issue & renew
- **File manager** — browse and edit website files (ZIP auto-extract)
- **Terminal** — interactive web shell (admin full access; non-admins start in their document root — restricted cwd only, not a security jail) with session command log
- **Security Manager** — visitors, threats, IP block/whitelist

## Requirements

- **Node.js 20+** — [nodejs.org](https://nodejs.org) or **nvm** latest LTS (`nvm install --lts`)
- The **npx installer** uses nvm’s latest LTS when nvm is present (installs that LTS if missing) and points systemd at the same Node binary
- Start scripts **auto-install Node** if missing (Linux via nvm LTS, macOS via Homebrew, Windows via winget), then start the panel
- No Docker required
- Panel metadata uses **SQLite**. Customer databases use **PostgreSQL**, which the Linux installer installs if it is missing (skips if already installed)

---

## Admin permissions (important)

| What | Needs admin? | Why |
|------|--------------|-----|
| Web panel (browser UI) | No | Runs as normal user |
| Testing / dry-run mode | No | Commands are simulated |
| **Live hosting control** (domains, mail, FTP, SSL, files on server) | **Yes** | Must create vhosts, users, certificates in system paths |

### How to start with admin

| Platform | Command |
|----------|---------|
| **Windows** | `Start Naviyra Panel (Admin).bat` |
| **Linux** | `sudo ./start-admin.sh` |
| **macOS** | `sudo ./start-admin.sh` |

### Without admin (safe testing)

| Platform | Command |
|----------|---------|
| **Windows** | `Start Naviyra Panel.bat` (dry-run by default) |
| **Linux** | `./start.sh` with `AGENT_DRY_RUN=true` in `.env` |

The dashboard shows your **platform** and **permission level** (Administrator / root / standard user).

---

## Install with npx

Requires **Node.js 20+**. On Linux the installer prefers **nvm’s latest LTS** (installs it if missing) so systemd and native modules use the same Node — not Ubuntu’s older `/usr/bin/node`. Run with `sudo` so the panel can install to `/opt/naviyra-panel`, install **PostgreSQL** if it is not already present, and optionally register a systemd service.

```bash
npx naviyra-hosting-pannel
```

That opens a menu: **Install**, **Upgrade**, or **Reconfigure**. To install in one step:

```bash
npx naviyra-hosting-pannel install --dir /opt/naviyra-panel
```

The installer asks for the same values stored in `.env` and shows an example for each field:

| You enter | Written to `.env` | Example |
|-----------|-------------------|---------|
| Panel domain | `PANEL_HOSTNAME` | `hpanel.yourdomain.com` |
| Server public IPv4 | `SERVER_PUBLIC_IP` | `203.0.113.10` |
| Public panel URL | `PANEL_PUBLIC_URL` | `https://hpanel.yourdomain.com` |
| Nameservers | `DNS_NS1` / `DNS_NS2` | `ns1.yourdomain.com` / `ns2.yourdomain.com` |
| Default server hostname | `DEFAULT_SERVER_HOSTNAME` | `s1.yourdomain.com` |
| Mail hostname template | `MAIL_HOSTNAME` | `mail.{domain}` |
| System mail From | `MAIL_FROM` | `noreply@yourdomain.com` |
| Let's Encrypt email | `LETSENCRYPT_EMAIL` | `admin@yourdomain.com` |
| Panel / agent ports | `PANEL_PORT` / `AGENT_PORT` | `3000` / `4000` |
| Dry-run mode | `AGENT_DRY_RUN` | `false` on Linux production, `true` on Windows |
| Headless (no browser) | `NAVIYRA_NO_BROWSER` | `true` on a VPS |

DNS and mail fields default from the **zone apex** of the hostname you enter (`hpanel.example.com` → `ns1.example.com`). Secrets (`AGENT_API_KEY`, `SESSION_SECRET`, `TWO_FACTOR_ENC_KEY`) are generated automatically.

Recommended production split:

- **`hpanel.yourdomain.com`** — control panel (`PANEL_HOSTNAME` / `PANEL_PUBLIC_URL`)
- **`yourdomain.com`** — marketing site (normal domain in the panel)
- **`ns1` / `ns2.yourdomain.com`** — nameservers (never `ns1.hpanel.yourdomain.com`)

After install, open the public panel URL (or `http://YOUR_SERVER_IP:3000`) and create the admin account.

### Upgrade

Keeps your `.env` and `data/` (database). Copies new files, reinstalls dependencies, and rebuilds.

```bash
npx naviyra-hosting-pannel upgrade --dir /opt/naviyra-panel
```

### Change `.env` later

```bash
npx naviyra-hosting-pannel reconfigure --dir /opt/naviyra-panel
```

### Uninstall

Stops Naviyra systemd units (panel, visitor ingest, backups, expire-blocks), **removes nginx files the panel installed** (visitor log format, websocket map, snippets, panel vhost), **deletes the panel database** (`data/naviyra.db`, so the next install shows first-time admin setup), and deletes the install directory. You are asked whether to also drop panel-created PostgreSQL databases (default: yes) and whether to remove hosted websites (`/var/www`), mailboxes, and DNS zone files (default: keep them). nginx/PostgreSQL/BIND packages themselves are left installed.

```bash
npx naviyra-hosting-pannel uninstall --dir /opt/naviyra-panel
```

Windows default directory is `%LOCALAPPDATA%\NaviyraPanel` if you omit `--dir`.

---

## Quick start (all platforms)

The same command works on **Windows, Linux, and macOS**:

```bash
npm run app
```

Stop:

```bash
npm run stop
```

---

## Windows

### Start

**Double-click:**
```
Start Naviyra Panel.bat
```

**Or terminal:**
```powershell
npm run app
```

### Stop

```
Stop Naviyra Panel.bat
```
or `npm run stop`

Agent runs in **dry-run mode** by default on Windows (safe testing).

---

## Linux

### Start (interactive)

```bash
chmod +x start.sh stop.sh
./start.sh
```

**Or:**
```bash
npm run app
```

On Linux servers **without a desktop**, use:
```bash
./start.sh --no-browser
# or
NAVIYRA_NO_BROWSER=true npm run app
```

Then open `http://YOUR_SERVER_IP:3000` from any computer.

Agent runs in **live mode** by default on Linux (real Nginx/mail/FTP commands). Set `AGENT_DRY_RUN=true` in `.env` to test safely.

### Stop

```bash
./stop.sh
# or
npm run stop
```

### Run as a background service (systemd)

For production Linux servers:

```bash
sudo chmod +x scripts/install-linux-service.sh
sudo ./scripts/install-linux-service.sh /opt/naviyra-panel www-data
```

Manage the service:
```bash
sudo systemctl status naviyra-panel
sudo systemctl restart naviyra-panel
sudo systemctl stop naviyra-panel
```

### Mail server (Postfix + Dovecot)

Install on the hosting server:

```bash
sudo chmod +x scripts/install-mail.sh
sudo ./scripts/install-mail.sh mail.example.com YOUR_PUBLIC_IP
```

The agent then creates real virtual mailboxes under `/var/mail/vhosts` when you add accounts in the panel.

Ports opened: **25, 465, 587, 143, 993** (and POP3 110/995).

### Authoritative DNS (BIND nameservers)

Customer domains should use:

- `ns1.naviyra.uk`
- `ns2.naviyra.uk`

Install BIND on the hosting server:

```bash
sudo chmod +x scripts/install-bind.sh
sudo ./scripts/install-bind.sh 136.243.196.166 naviyra.uk
```

Then set in `.env`:

```env
DNS_NS1=ns1.naviyra.uk
DNS_NS2=ns2.naviyra.uk
SERVER_PUBLIC_IP=136.243.196.166
BIND_ZONES_DIR=/etc/bind/zones
BIND_NAMED_DIR=/etc/bind/naviyra-zones.d
BIND_INCLUDE_FILE=/etc/bind/naviyra-zones.conf
BIND_RELOAD_CMD="rndc reload"
```

At your **domain registrar** (not Cloudflare DNS UI alone), set glue/host records for `ns1`/`ns2` to the server IP, then change `naviyra.uk` nameservers from Cloudflare (`donald`/`ashley`) to `ns1.naviyra.uk` and `ns2.naviyra.uk`. Until that change propagates, Cloudflare still answers for `naviyra.uk` itself; hosted customer domains that point NS at ns1/ns2 already query this server on port 53.

---

## macOS

Same as Linux:

```bash
chmod +x start.sh stop.sh
./start.sh
```

---

## First use (any OS)

1. Start the app (`npm run app` or platform script)
2. Browser opens → **http://localhost:3000**
3. Create your **admin account**
4. Manage hosting from the web dashboard

Keep the terminal open while using the app. Press **Ctrl+C** to stop.

---

## Architecture

```
┌────────────────────────────────────────────────┐
│  npm run app  /  start.sh  /  Start.bat        │
│         │                                      │
│         ├── Web Panel  →  :3000  (browser UI)    │
│         ├── Agent      →  :4000  (server ops)  │
│         └── SQLite     →  data/naviyra.db      │
└────────────────────────────────────────────────┘
```

| Platform | Start (testing) | Start (admin / production) | Stop |
|----------|-----------------|------------------------------|------|
| Windows | `Start Naviyra Panel.bat` | `Start Naviyra Panel (Admin).bat` | `Stop Naviyra Panel.bat` |
| Linux | `./start.sh` | `sudo ./start-admin.sh` | `./stop.sh` |
| macOS | `./start.sh` | `sudo ./start-admin.sh` | `./stop.sh` |
| All | `npm run app` | set `AGENT_DRY_RUN=false` + run as admin | `npm run stop` |

---

## Deploy to production server

Put SSH credentials in local `.env` (never commit `.env`):

```env
DEPLOY_HOST=136.243.196.166
DEPLOY_USER=root
DEPLOY_PASSWORD=your-ssh-password
DEPLOY_PORT=22
```

Then from this machine:

```bash
npm run deploy
```

This packs sources (excludes `node_modules`, `.next`, `.env`, `data`), uploads to the server, and runs `scripts/remote-deploy.sh` (`/opt/naviyra-panel` install, build, systemd restart).

**Auth (preferred):** leave `DEPLOY_PASSWORD` empty and use SSH keys — no password on the machine at all.  
**Password auth:** Windows uses PuTTY `-pwfile` (not `-pw`); Linux/macOS uses `sshpass -e` + `SSHPASS` so the password is not visible in process argv. PuTTY ≥ 0.78 required for `-pwfile`.

## Production build (optional)

```bash
npm run build
```

The launcher automatically uses production mode when `.next` exists.

---

## Terminal (web shell)

Dashboard → **Tools → Terminal**.

| Role | Scope |
|------|--------|
| **ADMIN** | Full server shell (optional: start in a domain document root) |
| **USER / RESELLER** | Shell starts in the selected domain/subdomain document root (`HOME` set there). **Not a security boundary** — no chroot/namespace; users can still `cd` elsewhere with the agent process’s OS permissions. |

Do not treat “jail” mode as containment. For real isolation, run the agent as a least-privilege OS user or use OS/container sandboxing outside the panel.

### Local development

The browser connects to the agent WebSocket at `ws://127.0.0.1:4000/terminal` (derived from `AGENT_URL`). No extra nginx config is required.

Live PTY requires `AGENT_DRY_RUN=false` and admin/root on Linux. On Windows dry-run, the session shows a dry-run banner instead of a real shell.

### Production (HTTPS panel)

1. Set in `.env` (use your public panel host and agent port):

```bash
NEXT_PUBLIC_TERMINAL_WS_URL=wss://hpanel.naviyra.uk/terminal-ws/terminal
AGENT_URL=http://127.0.0.1:4100
```

2. Proxy WebSocket upgrades on the panel nginx vhost:

```nginx
location /terminal-ws/ {
    proxy_pass http://127.0.0.1:4100/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

Adjust `4100` to match `AGENT_PORT`. Reload nginx after editing.

Session command/output lines are stored in SQLite (`TerminalSession` / `TerminalSessionLog`) for audit.

---

## Backup Worker (systemd timer)

Admin → **Backups**. Scheduled archives (panel DB, `/var/www`, DNS, optional mail) via a **systemd timer** that POSTs to `/api/backups`.

### Install units (once on the server)

```bash
sudo chmod +x scripts/install-backup-worker.sh scripts/backup-worker.sh
sudo ./scripts/install-backup-worker.sh /opt/naviyra-panel
```

Optional `.env`:

```env
BACKUP_WORKER_TOKEN=change-me   # defaults to AGENT_API_KEY
```

### Use from the panel

1. Open **Admin → Backups**
2. Choose schedule, retain count, and what to include
3. Enable scheduled backups → **Save & sync timer**
4. Or click **Run now**

Useful systemd commands:

```bash
systemctl list-timers naviyra-backup.timer
systemctl start naviyra-backup.service
journalctl -u naviyra-backup.service -n 50
```

### Restore

In **Admin → Backups**, open a completed run and click **Restore**.

That overwrites selected data from the archive (sites, DNS, panel DB). A safety copy of the live DB is written first (`*.pre-restore-*`). Restoring the DB schedules a panel restart.

Manual CLI (same archive layout):

```bash
cd /tmp && mkdir restore && tar -xzf /var/backups/naviyra/naviyra-backup-XXXX.tar.gz -C restore
# sites
cp -a restore/sites/. /var/www/
# panel DB (then restart)
cp -a /opt/naviyra-panel/data/naviyra.db /opt/naviyra-panel/data/naviyra.db.bak
cp restore/panel-db/naviyra.db /opt/naviyra-panel/data/naviyra.db
systemctl restart naviyra-panel
```

Archives default to `/var/backups/naviyra/naviyra-backup-*.tar.gz`.

---

## Controller panel + registered nodes

One **controller** (this Next.js panel + SQLite) can manage **one or many** Server Agents. A one-VPS install is the same code path as a fleet: the first Server row is this machine, with `agentUrl` like `http://127.0.0.1:4000` (or `AGENT_URL`) and `agentKey` = `AGENT_API_KEY`.

Every domain has exactly one `serverId`. Hosting actions always go `domain.serverId` → that row’s `agentUrl` + `agentKey` → `POST /execute`. There is no “empty URL means local process” fallback (that would create sites on the wrong node).

```
Browser → Panel controller → SQLite
                │
                ├── serverId A → Node agent (s1)
                └── serverId B → Node agent (s2)
```

Roles are **ADMIN** and **USER** only.

### Add another node

1. On the second machine, install Node.js, copy `agent/`, set `AGENT_PORT`, `AGENT_API_KEY`, `AGENT_DRY_RUN=false`.
2. Start the agent as root on Linux: `cd agent && npm install && npm run dev` (or systemd).
3. In **Admin → Servers**, add the node with hostname, IP, **Agent URL** (`http://<ip>:4000` or a TLS reverse-proxy URL), and the same agent key.
4. When creating a domain, pick that server. Ping must succeed before you rely on it.

### Move a site between nodes

Admin → Domains → **Migrate** (when more than one server is registered). The panel orchestrates:

1. Export files  
2. Export databases  
3. Transfer the archive through the controller (no SSH)  
4. Import on the destination agent  
5. Rebuild nginx / app units  
6. Restore SSL  
7. Ping the destination agent  
8. Update `Domain.serverId`  
9. Remove nginx on the source node  

Point public DNS at the destination when you cut over.

### Plugins

Each agent exposes `GET /plugins` and `list_plugins` / `plugin_invoke` on `/execute`. The panel stores the last catalog per server. Built-in PostgreSQL, runtimes, mail/DNS/FTP/Docker, and local backups are registered on the agent. Extra engines (MySQL, Redis, S3, …) appear as available; implement them by dropping `agent/plugins/contrib/<id>.ts` and restarting that agent — **do not fork panel core**.

### Separate panel install

A full second Naviyra install on another machine has its **own** database and is not linked. Use that only when you want independent panels.

---

## Configuration (.env)

| Variable | Description |
|----------|-------------|
| `PANEL_PORT` | Web UI port (default 3000) |
| `AGENT_PORT` | Agent port (default 4000) |
| `AGENT_DRY_RUN` | `true` = simulate, `false` = real commands |
| `SERVER_PUBLIC_IP` | Your server's public IPv4 for DNS A records (default `127.0.0.1`) |
| `PANEL_HOSTNAME` | Control-panel hostname (e.g. `hpanel.yourdomain.com`). Not the marketing apex. |
| `PANEL_PUBLIC_URL` | Public panel URL (e.g. `https://hpanel.yourdomain.com`) |
| `DEPLOY_HOST` | SSH host for `npm run deploy` (falls back to `SERVER_PUBLIC_IP`) |
| `DEPLOY_USER` | SSH user for deploy (default `root`) |
| `DEPLOY_PASSWORD` | SSH password for deploy (omit if using SSH keys / `sshpass` not needed) |
| `DEPLOY_PORT` | SSH port (default `22`) |
| `DNS_NS1` | Primary nameserver hostname (default `ns1.naviyra.uk`) |
| `DNS_NS2` | Secondary nameserver hostname (default `ns2.naviyra.uk`) |
| `BIND_ZONES_DIR` | BIND zone files dir (e.g. `/etc/bind/zones`) |
| `BIND_NAMED_DIR` | Per-domain named snippets (e.g. `/etc/bind/naviyra-zones.d`) |
| `BIND_INCLUDE_FILE` | Master include listing those snippets (e.g. `/etc/bind/naviyra-zones.conf`) |
| `BIND_RELOAD_CMD` | BIND reload command (default `rndc reload`) |
| `MAIL_HOSTNAME` | Mail server hostname template (default `mail.{domain}`). Deploy provisions `mail.{zone apex}` when public DNS points at `SERVER_PUBLIC_IP`. |
| `MAIL_FROM` | System From address for password reset and admin alerts (must pass SPF for this server) |
| `ADMIN_ALERTS_ENABLED` | `false` disables admin alert mail (default on) |
| `ADMIN_ALERT_COOLDOWN_MS` | Minimum time between identical alerts (default 1800000 = 30 min) |
| `NAVIYRA_NO_BROWSER` | `true` = don't auto-open browser |

---

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/domains` | Domain management |
| `/api/subdomains` | Subdomain management |
| `/api/mail` | Mail accounts |
| `/api/ftp` | FTP accounts |
| `/api/ssl` | SSL issue/renew |
| `/api/dns` | DNS zones (auto-sync on domain/subdomain changes) |
| `/api/files` | File browser/editor |

---

## Build installers (.exe / .deb / .AppImage)

Package the app for distribution (includes embedded Node.js — no separate Node install needed):

| Platform | Command | Output |
|----------|---------|--------|
| **Windows** | `npm run package:win` | `dist/NaviyraPanel-Setup-0.1.0.exe` + portable zip |
| **Linux .deb** | `npm run package:deb` | `dist/naviyra-panel_0.1.0_amd64.deb` |
| **Linux AppImage** | `npm run package:appimage` | `dist/NaviyraPanel-0.1.0-x86_64.AppImage` |
| **Linux (both)** | `npm run package` | .deb + .AppImage |

### Requirements for building

- **All:** Node.js 20+ on the build machine
- **Windows .exe:** [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`ISCC.exe` in PATH). Without it, only a portable zip is created.
- **Linux .deb:** `dpkg-deb` (`sudo apt install dpkg`)
- **AppImage:** Linux build host; downloads `appimagetool` automatically

### Install on end-user machines

**Windows:** Run `NaviyraPanel-Setup-*.exe`, then launch from Start Menu.

**Debian/Ubuntu:**
```bash
sudo dpkg -i naviyra-panel_*.deb
sudo systemctl enable --now naviyra-panel
# Open http://localhost:3000
```

**AppImage:**
```bash
chmod +x NaviyraPanel-*.AppImage
./NaviyraPanel-*.AppImage
```

Edit `/opt/naviyra-panel/app/.env` (deb) or `app/.env` in the bundle for `SERVER_PUBLIC_IP` and production settings.

## App runtimes (React / PHP / Python / Go)

On the server (once):

```bash
sudo bash scripts/install-runtimes.sh
```

| Type | How it works |
|------|----------------|
| **React / Static** | Upload built SPA files to `public_html`. Nginx falls back to `index.html` for client routes. |
| **PHP** | PHP-FPM + `try_files` front controller. |
| **Python** | Set start command (e.g. `python3 -m uvicorn main:app --host 127.0.0.1 --port 12000`). Panel writes a systemd unit and nginx reverse-proxies to `127.0.0.1:$PORT`. |
| **Go** | Upload a **compiled** binary; start command like `./app`. Process must listen on `PORT` / `127.0.0.1`. |

In **Domains** / **Subdomains**, use **Runtime** to change app type and Start / Stop / Restart Node, Python, or Go apps. Set **Application root** (folder under the site document root) and **Application startup file** (e.g. `server.js`). Ports are allocated in **12000–12999** and stay localhost-only.

### WebSockets (proxy apps)

Python / Go (and any site reverse-proxied to `127.0.0.1:$PORT`) support browser **WebSocket** upgrades:

- Nginx sets `Upgrade` / `$connection_upgrade` and long proxy timeouts (1 hour)
- Clients connect to `wss://your-domain/...` on the same host as the app
- Your process must listen on the assigned localhost port and handle the Upgrade itself (e.g. Socket.IO, `ws`, FastAPI WebSocket)

Static and PHP document-root sites are not reverse-proxied; put a WebSocket backend on a **proxy app** subdomain (or switch the site runtime) if you need `wss://`.

Deploy installs `/etc/nginx/conf.d/naviyra-websocket-map.conf` and refreshes existing proxy vhosts (`scripts/install-websocket-map.sh`).

## License

MIT — see [LICENSE](./LICENSE).
