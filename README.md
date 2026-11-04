# 🚦 traffic-bot — Desktop Traffic Lab

[![Website](https://img.shields.io/badge/website-live-22d3ee?logo=googlechrome&logoColor=white)](https://zougar99.github.io/traffic-bot/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/zougar99/traffic-bot/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/zougar99/traffic-bot?style=social)](https://github.com/zougar99/traffic-bot)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)](https://github.com/zougar99/traffic-bot)
[![Electron](https://img.shields.io/badge/Electron-26-47848F?logo=electron&logoColor=white)](https://github.com/zougar99/traffic-bot)
[![Selenium](https://img.shields.io/badge/Selenium-4.x-43B02A?logo=selenium&logoColor=white)](https://github.com/zougar99/traffic-bot)

> **Desktop traffic lab** for SEO testing and analytics validation. An Electron app that launches
> Selenium Chrome sessions through a rotating proxy pool, simulates human behaviour, walks
> search-engine paths, optionally engages with pages, and reports every run to Telegram.

**🌐 Live site → [zougar99.github.io/traffic-bot](https://zougar99.github.io/traffic-bot/)**

---

## 📖 Table of contents

- [Features](#-features)
- [How it works](#-how-it-works)
- [Tech stack](#-tech-stack)
- [Installation](#-installation)
- [Project layout](#-project-layout)
- [Data folders](#-data-folders)
- [Using the app](#-using-the-app)
- [Session settings](#-session-settings)
- [Modes](#-modes)
- [Telegram control](#-telegram-control)
- [npm scripts](#-npm-scripts)
- [How the runner behaves](#-how-the-runner-behaves)
- [FAQ](#-faq)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

- ✔ **Three operating modes** — `Direct` URL visits, `Google` search-to-click journeys, `Proxy` service searches
- ✔ **Proxy rotation** — pools of `host:port`, `user:pass@host:port` or full URLs loaded from `proxy/`, assigned per session index
- ✔ **Stealth layer** — navigator / WebGL / Canvas / Audio fingerprint patches plus randomised Chrome launch flags
- ✔ **Human-like behaviour** — configurable delay after load, dwell time before engagement, natural scroll and click patterns
- ✔ **Engagement toolkit** — optional like + comment actions, comment library in `comments/`, rotating identities from `email/`
- ✔ **Multi-URL batches** — queue several target URLs with a session count per URL; the runner interleaves rounds
- ✔ **Telegram control** — `/run`, `/stop`, `/status`, `/myid`, `/testnotify` plus start / done / error notifications
- ✔ **Headless & GUI modes** — watch the browsers or run quietly in the background
- ✔ **Live session logs** — proxy, identity, mode and outcome printed for every session
- ✔ **Local-first** — no SaaS account; proxies, keywords and libraries stay on your machine

---

## 🔮 How it works

```
                ┌───────────────────────────────┐
                │   Electron desktop window     │
                │   index.html + renderer.js    │
                └───────────────┬───────────────┘
                                │ IPC (preload.js)
                                ▼
                ┌───────────────────────────────┐
                │   Runner — libs/index.js      │
                │   one campaign at a time      │
                └───┬───────────┬───────────┬───┘
                    │           │           │
        ┌───────────▼──┐  ┌─────▼─────┐  ┌──▼────────────┐
        │ proxy pool   │  │ Selenium  │  │ engagement    │
        │ proxy/*      │  │ Chrome    │  │ like/comment  │
        └──────────────┘  │ + stealth │  │ libs/autobot  │
                          └─────┬─────┘  └───────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  target site / SERP   │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Telegraf bot         │
                    │  reports + /run       │
                    └───────────────────────┘
```

### Pipeline

1. **Load inputs** — target URLs, keyword, proxy pool, email list and comment library
2. **Pick a proxy** — the next entry in the pool is assigned to the current session index
3. **Launch Chrome** — stealth flags, proxy argument, optional headless
4. **Navigate** — direct URL, or a search query typed at the SERP
5. **Simulate** — delay after load, scroll, dwell, then optional engagement
6. **Log** — proxy, identity, mode and result go to the console
7. **Rotate** — the browser is closed, the index advances, the pause delay applies
8. **Report** — Telegram receives a start card and a done / error summary

---

## 💻 Tech stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 18+ |
| Desktop shell | Electron | 26.x |
| Browser automation | Selenium WebDriver | 4.x |
| Driver | ChromeDriver (npm) | 147.x |
| Telegram | Telegraf | 4.x |
| Proxies | HTTP / HTTPS / SOCKS5 | — |
| Platform | Windows / Linux | — |

---

## 🚀 Installation

### Prerequisites
- Node.js 18 or higher
- Google Chrome installed
- (optional) a Telegram bot token for remote control and alerts

```bash
git clone https://github.com/zougar99/traffic-bot.git
cd traffic-bot
npm install          # Electron + Selenium + ChromeDriver + Telegraf
npm start            # launch the desktop app
```

---

## 🗂 Project layout

```
traffic-bot/
├── index.js          Electron main process, IPC handlers, window
├── index.html        app UI (single panel)
├── renderer.js       UI logic, form persistence, validation
├── preload.js        contextBridge API exposed to the renderer
├── libs/
│   ├── index.js      runner: modes, SERP parsing, session loop
│   ├── proxy.js      reads every file in proxy/
│   ├── spoofing.js   stealth / fingerprint patches
│   ├── autobot.js    engagement actions (scroll, like, comment, email)
│   ├── comments.js   comment library loader
│   ├── email.js      email list loader
│   ├── telegram.js   Telegraf bot + /run /stop /status commands
│   └── telegramNotify.js  notification helpers
├── proxy/            proxy lists (one entry per line)
├── comments/         comment library (one per line)
├── email/            email identities (one per line)
├── site/             marketing website (GitHub Pages)
└── scripts/          test helpers (test-telegram.js)
```

---

## 📥 Data folders

The app creates these folders on demand from the **Tools** row.

| Folder | Content | Format |
|--------|---------|--------|
| `proxy/` | proxy pool — every file in the folder is read | `1.2.3.4:8080`, `user:pass@1.2.3.4:8080`, `http://…`, `socks5://…` |
| `email/` | identities used when email rotation is on | `name@domain.com` (one per line, invalid lines ignored) |
| `comments/` | comment library for engagement | free text, one comment per line |

```
proxy/pool.txt
----------------
http://user:pass@1.2.3.4:8080
socks5://5.6.7.8:1080
9.10.11.12:3128
```

---

## 🧰 Using the app

| Step | Action |
|------|--------|
| 1 | Paste a target URL (use **+ Add URL** to queue more) |
| 2 | Set **COUNT** — sessions per URL |
| 3 | Enter a keyword if the mode is `Google` or `Proxy` |
| 4 | Choose **Headless** if you don’t want to watch Chrome |
| 5 | Tune **Pause**, **After load** and **Dwell** (seconds) |
| 6 | Optionally enable **Like** / **Comment** |
| 7 | Press **▶ Start**, then **■ Stop** to abort |

The form state is persisted in `localStorage`, so your last setup is restored on the next launch.

---

## ⚙️ Session settings

| Field | Default | Effect |
|-------|---------|--------|
| **Headless** | off | hides Chrome; recommended for long batches |
| **Rotate emails** | on | picks the next address in `email/` for each session |
| **Pause (s)** | 0 | wait between two sessions |
| **After load (s)** | 1 | delay after navigation before any interaction |
| **Dwell (s)** | 2.5 | time spent on the page before engagement |
| **Count** | 1 | sessions per URL |

---

## 🧭 Modes

| Mode | Flow | Best for |
|------|------|----------|
| **Direct** | proxy → target URL → scroll → dwell → engagement | analytics and tracking validation |
| **Google** | proxy → `google.com/search` → locate your domain in the SERP (with pagination) → click → dwell → engagement | organic search signal |
| **Proxy** | external proxy browsing service → search → locate your domain → click → dwell → engagement | routes the whole journey through a third party |

---

## 📡 Telegram control

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Copy the example config and fill it in:

```bash
cp telegram.config.json.example telegram.config.json
```

```json
{
  "token": "123456789:AA...",
  "allowedChatIds": [123456789]
}
```

3. Start the app — the bot comes up with it. Send `/myid` to the bot, then paste your chat id into `allowedChatIds`.

| Command | Description |
|---------|-------------|
| `/myid` | returns your chat id |
| `/help` | command reference |
| `/status` | proxy pool size |
| `/run <url> <count> <mode> [keyword]` | start a campaign, e.g. `/run https://site.com 10 Google "best seo tools"` |
| `/stop` | abort the current campaign |
| `/testnotify` | send a test notification through the app’s channel |

`/run` also accepts `--like` and `--comment <text>`.

Reports look like this:

```
🤖 Traffic Bot
━━━━━━━━━━━━━━━━━━
▶ Run started — mode Google
🌐 2 URL(s) × 10 = 20 sessions
✅ Done — 18/20 completed
```

---

## 📜 npm scripts

```bash
npm start                 # launch the desktop app
npm run dev               # same, with Electron logging enabled
npm run test:telegram     # verify telegram.config.json and ping the bot
```

---

## 🔁 How the runner behaves

- Only **one campaign runs at a time** — a second `Start` while a run is active is ignored.
- Proxy selection is deterministic: `pool[sessionIndex % pool.length]`, so every session gets a fresh node in order.
- A failing session is logged and skipped — it never aborts the campaign.
- With several URLs the runner works in **rounds**: URL 1 … URL n, then the next round, so traffic is spread over time.
- Every session opens and closes its own browser instance, so no cookies or state leak between sessions.

---

## ❓ FAQ

### Do I need a server?
No. It is a desktop app; everything lives in local folders.

### How many proxies do I need?
Five to ten healthy nodes is a sane start for small batches. Large daily volumes need a bigger residential pool.

### Does headless mode work?
Yes, and it is recommended for long runs. Keep it off while debugging a flow so you can watch the browser.

### What happens if a proxy fails?
The session fails, the error is logged, and the next session uses the next proxy in the pool.

### Is Telegram required?
No — the desktop UI works on its own. Telegram only adds remote control and run reports.

### Is this legal?
It is designed for **SEO testing and analytics validation on properties you own or are authorised to test**.
Always comply with the terms of service of the sites you interact with.

---

## 🚧 Troubleshooting

| Problem | Solution |
|---------|----------|
| **Chrome not found** | install Google Chrome, then run `npm rebuild chromedriver` |
| **ChromeDriver error** | press **ChromeDriver** in the Tools row, or reinstall dependencies |
| **No proxies detected** | add files to `proxy/`, then press **Proxies** to refresh the count |
| **No search results clicked** | verify the target URL matches the domain ranking for that keyword |
| **Telegram silent** | run `npm run test:telegram` and check `allowedChatIds` |
| **High failure rate** | slow the run down (increase Pause / Dwell) and use healthier proxies |
| **Blank window** | press **Reload UI** in the Developer row, or restart the app |

---

## 🤝 Contributing

Issues and pull requests are welcome.

```bash
git clone https://github.com/zougar99/traffic-bot.git
cd traffic-bot
npm install
npm start
```

Keep changes focused, describe the behaviour you changed, and test on Chrome before opening a PR.

---

## 📐 License

MIT — see [LICENSE](LICENSE).

> For educational and testing purposes. You are responsible for how you use it.
