# Deploying Rank Tracker Pro

The app is one Node process, one SQLite file and a static folder. It runs
comfortably on the smallest VPS (1 vCPU / 512 MB) and needs no database server.

Requirements: **Node ≥ 22.5** (for the built-in `node:sqlite`), ~100 MB disk.

---

## 1. VPS walkthrough (Ubuntu 22.04/24.04)

```bash
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo useradd -r -m -d /opt/rank-tracker rt
sudo mkdir -p /opt/rank-tracker && sudo chown rt: /opt/rank-tracker
sudo -u rt git clone <your-repo> /opt/rank-tracker/app
cd /opt/rank-tracker/app/rank-tracker

sudo -u rt cp .env.example .env
sudo -u rt npm start          # first boot: opens the setup form
```

Then open `http://YOUR_IP:4170`, create the owner account, and press Ctrl-C.

### Keep it running (systemd)

`/etc/systemd/system/rank-tracker.service`:

```ini
[Unit]
Description=Rank Tracker Pro
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=rt
WorkingDirectory=/opt/rank-tracker/app/rank-tracker
EnvironmentFile=/opt/rank-tracker/app/rank-tracker/.env
ExecStart=/usr/bin/node --no-warnings src/server.js
Restart=always
RestartSec=5
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/rank-tracker

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rank-tracker
sudo systemctl status rank-tracker
journalctl -u rank-tracker -f
```

The process handles `SIGTERM`, so `systemctl restart` stops the job runner
cleanly.

### HTTPS with Caddy (recommended)

```
# /etc/caddy/Caddyfile
rank.example.com {
    reverse_proxy 127.0.0.1:4170
}
```

```bash
sudo apt install caddy && sudo systemctl reload caddy
```

Set `COOKIE_SECURE=true` and `NODE_ENV=production` in `.env` once TLS works.
No `X-Forwarded-For` config is needed; the app reads the socket address.

### HTTPS with nginx

```nginx
server {
    server_name rank.example.com;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4170;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
    }
}
```

```bash
sudo certbot --nginx -d rank.example.com
```

---

## 2. Docker

`Dockerfile` (already in this folder):

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production PORT=4170 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 4170
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:4170/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--no-warnings","src/server.js"]
```

```bash
docker build -t rank-tracker .
docker run -d --name rank-tracker \
  -p 4170:4170 \
  -v rank-tracker-data:/data \
  --env-file .env \
  --restart unless-stopped \
  rank-tracker
```

`docker compose up -d` works too:

```yaml
services:
  app:
    build: .
    ports: ['4170:4170']
    env_file: [.env]
    volumes: ['rt-data:/data']
    restart: unless-stopped
volumes:
  rt-data:
```

The SQLite file lives in the volume, so `docker compose down && up` keeps all
history. Back it up as described below.

---

## 3. Schedules

The runner wakes every `SCHEDULER_INTERVAL_MINUTES` (60 by default) and runs any
job whose day-of-week + hour matches and that has not already run today.

```
Sites → Schedules → add  Mon–Fri at 09:00
```

Requirements and gotchas:

- `SCHEDULER_ENABLED=true` (default) and the process must be alive (systemd /
  Docker `restart` handle that).
- Times are **server local time**. Set `TZ=Europe/Casablanca` in `.env` if the
  box is UTC and you want local hours.
- `SCHEDULER_RUN_ON_BOOT=true` catches up on a missed run at start.
- Only one process may own the database — never run two instances against the
  same SQLite file.

---

## 4. Google Sheets reporting

Alerts can append to a spreadsheet through an Apps Script webhook (no OAuth
dance, no service account).

1. Create a sheet, then **Extensions → Apps Script**:

```javascript
const TOKEN = 'change-me';                    // must equal GOOGLE_SHEETS_TOKEN
const SHEET = 'Alerts';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.token !== TOKEN) return ContentService.createTextOutput('no');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['received', 'site', 'keyword', 'engine', 'kind', 'position', 'previous', 'url']);
  }
  (body.rows || []).forEach(r => sheet.appendRow([
    new Date(), r.site || '', r.phrase || '', r.engine || '',
    r.kind || '', r.position ?? '', r.previous ?? '', r.url || ''
  ]));
  return ContentService.createTextOutput('ok');
}
```

2. **Deploy → New deployment → Web app**, execute as *me*, access *anyone*.
   Copy the `/exec` URL.

```env
GOOGLE_SHEETS_ENABLED=true
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfy.../exec
GOOGLE_SHEETS_TOKEN=change-me
GOOGLE_SHEETS_ID=1AbC...          # optional, only for the "open sheet" link
```

3. Settings → *Send test alert*. The run summary shows `sheets: ok`.

The same pattern works for **Gmail**: point `EMAIL_WEBHOOK_URL` at a small
endpoint (Apps Script, Cloudflare Worker, n8n) that calls the Gmail API or
`MailApp.sendEmail`. See `docs/email.md`.

---

## 5. Backups

Everything is in two files.

```bash
# hot backup — safe while running
sqlite3 /opt/rank-tracker/app/rank-tracker/data/rank-tracker.db \
  ".backup /backup/rt-$(date +%F).db"

# or simply copy the whole data dir when the service is stopped
tar czf /backup/rt-$(date +%F).tgz -C /opt/rank-tracker/app/rank-tracker data
```

Nightly cron:

```cron
15 3 * * * sqlite3 /opt/rank-tracker/app/rank-tracker/data/rank-tracker.db ".backup /backup/rt-$(date +\%F).db" && find /backup -name 'rt-*.db' -mtime +30 -delete
```

`data/.secret` signs sessions — restore it together with the database or every
user has to log in again (harmless).

Restore: stop the service, put the `.db` back, start it.

---

## 6. Operations

| Task | Command |
| --- | --- |
| health | `curl -s localhost:4170/api/health` |
| tail logs | `journalctl -u rank-tracker -f` |
| add user | `npm run create-user -- a@b.c 'password' --name "A"` |
| backfill | `npm run collect -- --site 1 --date 2026-01-01` |
| demo data | `npm run seed` |
| tests | `npm test` |

**Upgrades**

```bash
sudo systemctl stop rank-tracker
sudo -u rt git -C /opt/rank-tracker/app pull
sudo systemctl start rank-tracker      # schema migrations run on boot
```

**Troubleshooting**

| Symptom | Cause / fix |
| --- | --- |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node < 22.5 — upgrade |
| Login bounces back | `COOKIE_SECURE=true` without HTTPS |
| `provider: mock` in `/api/health` | no SERP key set, or key rejected |
| Alerts say `skipped` | channel not configured — check `.env` and restart |
| Jobs never run | `SCHEDULER_ENABLED=false`, or the process is not running |
| Everything slow after months | prune old rows (below) |

```sql
-- keep 12 months of history
DELETE FROM positions WHERE date < date('now','-365 day');
VACUUM;
```
