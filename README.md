# 🚦 Traffic Bot

**Developer:** [@werlist99](https://t.me/werlist99)

> 🧪 Desktop traffic lab — controlled Chrome sessions via Selenium, rotating proxies, Google/proxy search flows, and Telegram notifications. Built with Electron.

---

## ✨ Features

- 🎯 **Session runs** — Direct visits, Google search path, or proxy gateway mode
- 🔄 **Proxies & identity** — Rotate HTTP proxies; optional email list rotation
- 💬 **Engagement hooks** — Optional scroll / like / comment flows (site-dependent)
- 📡 **Telegram** — Remote commands and desktop-run notifications

---

## 🛠 Tech Stack

| Layer | Tool |
|-------|------|
| Desktop shell | Electron |
| Browser automation | Selenium WebDriver + ChromeDriver |
| Bot notifications | Telegraf |
| UI | Vanilla JS + jQuery + Custom CSS |

---

## 📋 Prerequisites

- **Node.js** 18+ recommended
- **Google Chrome** installed
- **ChromeDriver** — major version must match Chrome (run `npm install chromedriver@latest` after Chrome updates)

---

## 🚀 Install & Run

```bash
cd traffic-bot
npm install
npm start
```

### 📬 Test Telegram notifications

```bash
npm run test:telegram
```

---

## ⚙️ Configuration

1. Copy `telegram.config.json.example` → `telegram.config.json`
2. Add your Telegram bot token and chat ID
3. Place proxy lists in `proxy/` (one per line)
4. Place email lists in `email/` (one per line)
5. Place comment templates in `comments/` (one per line)

---

## 🧩 Usage

1. Enter target **URL(s)**
2. Choose **mode**: `Direct` | `Google Search` | `Proxy Server`
3. Set **count** (how many sessions to run)
4. Toggle **engagement** options (Like / Comment)
5. Click **▶ Start**

---

## 📁 Project Structure

```
traffic-bot/
├── index.js            # Electron main process
├── index.html          # UI (renderer)
├── renderer.js         # UI logic
├── preload.js          # Context bridge
├── libs/               # Core logic
│   ├── index.js        # Session orchestrator
│   ├── autobot.js      # Browser automation
│   ├── proxy.js        # Proxy loader
│   ├── email.js        # Email rotation
│   ├── comments.js     # Comment loader
│   ├── spoofing.js     # Fingerprint spoofing
│   └── telegram*.js    # Telegram integration
├── proxy/              # Proxy list files
├── email/              # Email list files
├── comments/           # Comment templates
└── assets/             # Icons & logos
```

---

## ⚠️ Disclaimer

> 📚 **Educational use only.** Respect website terms of service and applicable laws. The author is not responsible for misuse.

---

## 📄 License

ISC — see `package.json`
