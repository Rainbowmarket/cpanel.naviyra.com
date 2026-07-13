# Naviyra Visitor & Security Manager

> **Integrated in Naviyra Panel:** Open **Tools → Security Manager** at `/dashboard/security` — works with `npm run app` on Windows/Linux using the panel's SQLite database. No separate PHP/MySQL setup required for daily use.

This folder also contains a **standalone PHP + MySQL + React** deployment for dedicated Linux servers (optional).

**Stack:** React admin dashboard · PHP 8.2 REST API · MySQL 8 · JWT auth · UFW/iptables/Nginx blocking

## Features

| Feature | Description |
|---------|-------------|
| **Multi-domain dashboard** | Monitor unlimited domains from one admin UI |
| **Visitor logging** | IP, domain, URL, browser, OS, country, timestamp |
| **Live visitors** | Real-time active sessions (5-minute window) |
| **Traffic statistics** | Daily/hourly aggregates per domain |
| **Threat detection** | SQL injection, XSS, path traversal, scanners, bots |
| **Auto-block** | Configurable threshold → UFW / iptables / Nginx deny |
| **Blocklist / whitelist** | Manual IP management with reasons |
| **Nginx log parser** | Batch ingest from `access.log` via cron |
| **Secure API** | JWT for admin, API key for ingest endpoints |

## Architecture

```
security-manager/
├── database/schema.sql       # MySQL schema
├── backend/                  # PHP REST API (port 8090)
│   ├── public/index.php      # Front controller
│   └── src/
│       ├── Controllers/      # HTTP handlers
│       ├── Services/         # Business logic
│       └── Middleware/       # JWT + ingest auth
├── frontend/                 # React dashboard (port 5174)
├── scripts/
│   ├── install-linux.sh      # One-shot installer
│   ├── log-parser.php        # Nginx log → API
│   └── nginx-security.conf   # Nginx snippet
└── tracker/beacon.php        # Optional per-request beacon
```

## Quick install (Linux)

```bash
cd security-manager
chmod +x scripts/install-linux.sh
sudo ./scripts/install-linux.sh
```

### Start services

**PHP API:**
```bash
cd backend/public
php -S 127.0.0.1:8090
```

**React dashboard:**
```bash
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5174** — login with `admin@naviyra.local` and the password set during install.

## Configuration

Copy `backend/.env.example` → `backend/.env`:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Min 16 chars — admin API tokens |
| `INGEST_API_KEY` | Key for log parser & beacon |
| `FIREWALL_METHOD` | `ufw`, `iptables`, or `nginx` |
| `FIREWALL_DRY_RUN` | `true` = simulate blocks (safe for dev) |
| `AUTO_BLOCK_THRESHOLD` | Threats before auto-block (default 5) |
| `NGINX_DENY_FILE` | Path to generated deny list |

Set `FIREWALL_DRY_RUN=false` and run API as **root** (or sudo) for live firewall rules.

## REST API

### Auth
```http
POST /api/auth/login
{"email":"admin@naviyra.local","password":"..."}

GET /api/auth/me
Authorization: Bearer <jwt>
```

### Ingest (log parser / beacon)
```http
POST /api/ingest
X-Ingest-Key: <INGEST_API_KEY>
{"host":"naviyra.uk","url":"/index.php?id=1' OR 1=1","ip":"203.0.113.5","user_agent":"..."}
```

### Admin endpoints (JWT required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/domains` | List monitored domains |
| GET | `/api/visitors` | Visitor log (`?domain_id=&search=`) |
| GET | `/api/visitors/live` | Live visitors |
| GET | `/api/stats/overview` | Dashboard counters |
| GET | `/api/security/events` | Threat log |
| GET/POST | `/api/blocklist` | Blocked IPs |
| DELETE | `/api/blocklist/{ip}` | Unblock IP |
| GET/POST | `/api/whitelist` | Trusted IPs |

## Nginx integration

1. Include blocked IPs in each `server {}`:
   ```nginx
   include /etc/nginx/naviyra-blocked-ips.conf;
   ```

2. Cron log parser (every minute):
   ```cron
   * * * * * php /path/to/security-manager/scripts/log-parser.php /var/log/nginx/access.log
   ```

3. Optional beacon in site footer:
   ```html
   <img src="https://your-server/naviyra-track?host=example.com&url=/page" width="1" height="1" alt="">
   ```

## Naviyra Panel integration

The main panel sidebar links to the Security Manager dashboard. Set in panel `.env`:

```env
SECURITY_MANAGER_URL=http://127.0.0.1:5174
```

Sync domains from the panel by POSTing to `/api/domains` with `naviyra_domain_id`.

## Threat detection rules

- **SQL injection** — UNION SELECT, OR 1=1, DROP TABLE, comments
- **XSS** — `<script>`, event handlers, `javascript:`
- **Path traversal** — `../`, encoded variants
- **Scanners** — wp-admin, .env, phpmyadmin, sqlmap, nikto
- **Bots** — User-agent patterns (bot, crawl, spider, curl)

High/critical findings trigger auto-block after `AUTO_BLOCK_THRESHOLD` events within `AUTO_BLOCK_WINDOW_MINUTES`.

## Production checklist

- [ ] Change default admin password
- [ ] Set strong `JWT_SECRET` and `INGEST_API_KEY`
- [ ] Use PHP-FPM + Nginx reverse proxy instead of built-in server
- [ ] Build frontend: `cd frontend && npm run build` → serve `dist/`
- [ ] Enable `FIREWALL_DRY_RUN=false` with appropriate sudo permissions
- [ ] Configure MySQL backups
- [ ] Optional: GeoLite2 MMDB at `GEOIP_DB_PATH` for offline geo lookup

## License

Part of the Naviyra hosting panel project.
