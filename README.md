# Naviyra Panel

A self-hosted hosting control panel (cPanel alternative). **Runs like software on Windows and Linux** — start once, control everything in your web browser.

Works on **Windows**, **Linux**, and **macOS**.

## Features

- **Domains** — add/remove domains, document roots
- **Subdomains** — create subdomains under any domain
- **Mail server** — email accounts per domain
- **FTP server** — FTP accounts per domain
- **SSL certificates** — Let's Encrypt issue & renew
- **File manager** — browse and edit website files
- **Terminal** — interactive web shell (admin full access; users jailed to document root) with session command log
- **Security Manager** — visitors, threats, IP block/whitelist

## Requirements

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- Start scripts **auto-install Node** if missing (Linux via apt/nodesource, macOS via Homebrew, Windows via winget), then start the panel
- No Docker required
- No PostgreSQL required (embedded SQLite database)

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
BIND_RELOAD_CMD=rndc reload
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
| **USER / RESELLER** | Shell jailed to the selected domain/subdomain document root |

### Local development

The browser connects to the agent WebSocket at `ws://127.0.0.1:4000/terminal` (derived from `AGENT_URL`). No extra nginx config is required.

Live PTY requires `AGENT_DRY_RUN=false` and admin/root on Linux. On Windows dry-run, the session shows a dry-run banner instead of a real shell.

### Production (HTTPS panel)

1. Set in `.env` (use your public panel host and agent port):

```bash
NEXT_PUBLIC_TERMINAL_WS_URL=wss://naviyra.uk/terminal-ws/terminal
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

## Multi-server setup (future)

Naviyra supports **one central panel** managing **multiple hosting servers**. This is different from running two separate panels.

### Two approaches

| Approach | What it is | Best for |
|----------|------------|----------|
| **Secondary server** | One panel, multiple machines with agents | WHM/cPanel-style hosting |
| **Secondary panel** | Full separate Naviyra install on another PC | Independent clients or regions |

### Option 1: Secondary server (recommended)

**Architecture**

```
Central Panel (your PC or VPS)
    ├── Primary Server   → agent on machine A
    └── Secondary Server → agent on machine B
```

Each domain is assigned to one server. The panel stores server name, hostname, IP, and a unique `agentKey`.

**Steps to add a secondary server**

1. **On the second machine**, install Node.js and copy the `agent/` folder (or clone the repo).
2. Create `.env` on that machine:
   ```env
   AGENT_PORT=4000
   AGENT_API_KEY=your-unique-secret-key-for-server-2
   AGENT_DRY_RUN=false
   ```
3. **Start the agent** on the second machine (Linux: run as root for live mode):
   ```bash
   cd agent && npm install && npm run dev
   ```
4. **Register the server** in the panel database (Servers UI coming soon; for now use Prisma Studio):
   ```bash
   npm run db:studio
   ```
   Add a row to **Server**:
   - `name`: `Secondary Server`
   - `hostname`: `server2.naviyra.com`
   - `ipAddress`: IP of the second machine (e.g. `192.168.1.50`)
   - `agentKey`: same key as step 2
   - `isActive`: `true`

5. **When adding a domain**, pick **Secondary Server** from the dropdown instead of Primary Server.

**Note:** Remote agent routing (`agentUrl` per server) is planned. Today the panel uses a single `AGENT_URL` in `.env` (default `http://127.0.0.1:4000`), so **only the local Primary Server is fully operational**. Multi-server support requires per-server agent URLs in a future update.

### Option 2: Secondary panel (separate install)

Run a **complete second Naviyra Panel** on another machine:

1. Copy or clone the project to the second machine.
2. Run `npm run setup` and `npm run app` there.
3. It gets its **own database**, users, and domains — not linked to the first panel.

Use this when you want two independent control panels (e.g. one for you, one for a client).

### Planned features

- **Servers** admin page — add/edit/remove servers from the UI
- **Per-server agent URL** — panel calls `http://{server-ip}:4000` automatically
- **Agent health** — online/offline status per server on the dashboard
- **Auto-hide server dropdown** when only one server exists

---

## Configuration (.env)

| Variable | Description |
|----------|-------------|
| `PANEL_PORT` | Web UI port (default 3000) |
| `AGENT_PORT` | Agent port (default 4000) |
| `AGENT_DRY_RUN` | `true` = simulate, `false` = real commands |
| `SERVER_PUBLIC_IP` | Your server's public IPv4 for DNS A records (default `127.0.0.1`) |
| `DNS_NS1` | Primary nameserver hostname (default `ns1.naviyra.uk`) |
| `DNS_NS2` | Secondary nameserver hostname (default `ns2.naviyra.uk`) |
| `BIND_ZONES_DIR` | BIND zone files dir (e.g. `/etc/bind/zones`) |
| `BIND_NAMED_DIR` | Per-domain named snippets (e.g. `/etc/bind/naviyra-zones.d`) |
| `BIND_INCLUDE_FILE` | Master include listing those snippets (e.g. `/etc/bind/naviyra-zones.conf`) |
| `BIND_RELOAD_CMD` | BIND reload command (default `rndc reload`) |
| `MAIL_HOSTNAME` | Mail server hostname template (default `mail.{domain}`) |
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

## License

Private — Naviyra
