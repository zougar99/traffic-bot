# 🚦 traffic-bot — Desktop Traffic Simulation Lab

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/zougar99/traffic-bot/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/zougar99/traffic-bot?style=social)](https://github.com/zougar99/traffic-bot)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)](https://github.com/zougar99/traffic-bot)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python)](https://github.com/zougar99/traffic-bot)
[![Selenium](https://img.shields.io/badge/Selenium-4.x-43B02A?logo=selenium)](https://github.com/zougar99/traffic-bot)

> **Desktop traffic lab** for SEO testing and analytics validation. Launches automated Selenium Chrome sessions with proxy rotation, human-like behavior simulation, multi-search engine support, and real-time Telegram alerts.

---

## 📖 Table of Contents
- [Features](#-features)
- [How It Works](#-how-it-works)
- [Tech Stack](#-tech-stack)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage Guide](#-usage-guide)
- [CLI Commands](#-cli-commands)
- [Proxy Management](#-proxy-management)
- [Search Engines](#-search-engines)
- [Behavior Profiles](#-behavior-profiles)
- [Telegram Integration](#-telegram-integration)
- [Performance](#-performance)
- [Screenshots](#-screenshots)
- [Roadmap](#-roadmap)
- [FAQ](#-faq)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features
- ✔ **Multi-Engine Search Automation** — Google, Bing, Yahoo, DuckDuckGo with randomized query patterns
- ✔ **Human Behavior Simulation** — Random mouse movements, natural scrolling, variable typing speed, click delays
- ✔ **Proxy Rotation** — HTTP/HTTPS/SOCKS5 with auto-rotation, health checks, and fallback pools
- ✔ **Stealth Mode** — Undetected ChromeDriver + fingerprint spoofing (WebGL, Canvas, Audio, Fonts)
- ✔ **Session Recording** — Full HAR capture, screenshots, console logs per session
- ✔ **Telegram Notifications** — Real-time alerts: session started, completed, errors, daily summary
- ✔ **Scheduling** — Cron-like scheduler with configurable intervals, random delays, and burst mode
- ✔ **Keyword Spinner** — Auto-generates keyword variations using synonyms, typos, and prefixes/suffixes
- ✔ **Geo-Targeting** — Configure search location via proxy geo + search engine region parameters
- ✔ **Cookie Management** — Session persistence, randomized cookie profiles per session
- ✔ **Headless & GUI Modes** — Run invisibly in background or watch browser actions in real-time
- ✔ **Multi-Profile** — Save and switch between traffic profiles (aggressive, gentle, random)

---

## 🔮 How It Works

```
                        ┌──────────────────────┐
                        │   Traffic Bot CLI   │
                        │   (Python Engine)   │
                        └──────────┬───────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
     │  Proxy Pool │    │  Selenium    │    │  Session     │
     │  (Rotation) │───►│  Chrome      │───►│  Recorder    │
     └──────────────┘    │  (Stealth)   │    │  (HAR + SS)  │
                          └──────┬───────┘    └──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
     │   Google    │    │    Bing      │    │  DuckDuckGo  │
     │   Search    │    │   Search     │    │   Search     │
     └──────────────┘    └──────────────┘    └──────────────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   ▼
                          ┌──────────────────┐
                          │  Telegram Bot    │
                          │  (Alerts/Logs)   │
                          └──────────────────┘
```

### Pipeline Flow

1. **Load Profile** — Read config, keywords, proxy list, behavior settings
2. **Select Proxy** — Pick next proxy from pool, verify health and geo
3. **Launch Browser** — Spawn Chrome with stealth config + proxy + randomized fingerprint
4. **Execute Search** — Navigate to search engine, type keyword with human-like delays, click results
5. **Record Session** — Capture HAR, screenshot, console logs, scroll depth
6. **Rotate** — Close browser, mark proxy used, select next keyword, repeat
7. **Report** — Send Telegram summary: sessions completed, errors, proxy stats

---

## 💻 Tech Stack

| Component | Technology | Version |
|-----------|-----------|--------|
| Language | Python | 3.10+ |
| UI | CustomTkinter | 5.x |
| Browser Automation | Selenium | 4.15+ |
| Stealth | undetected-chromedriver | 3.5+ |
| Proxy Support | requests + PySOCKS | Latest |
| Notifications | python-telegram-bot | 20.x |
| Scheduling | APScheduler | 3.10+ |
| HAR Recording | browserup-proxy | Latest |
| Platform | Windows / Linux | - |

---

## 🚀 Installation

### Prerequisites
- Python 3.10 or higher
- Google Chrome or Chromium installed
- (Optional) Telegram Bot Token for alerts

### Quick Install

```bash
git clone https://github.com/zougar99/traffic-bot.git
cd traffic-bot

# Create virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Verify ChromeDriver
python -c "from selenium import webdriver; print('OK')"
```

---

## 📄 Configuration

Edit `config.yaml` in the project root:

```yaml
general:
  headless: false            # Run browser in background
  session_timeout: 60       # Max seconds per session
  sessions_per_proxy: 3     # Sessions before rotating proxy
  cooldown_range: [5, 15]   # Random delay between sessions (seconds)

search:
  engines: [google, bing, duckduckgo]
  keywords_file: keywords.txt
  shuffle_keywords: true
  click_results: true        # Click 1-3 organic results
  scroll_depth: 3           # Page scrolls per session
  geo: us                   # Search region (us, uk, fr, de, etc.)

proxy:
  pool_file: proxies.txt     # One proxy per line (ip:port or protocol://ip:port)
  rotation: sequential       # sequential | random | performance
  health_check: true         # Test proxy before use
  health_url: http://httpbin.org/ip
  max_failures: 3            # Remove proxy after N failures
  geo_filter: us,uk,ca       # Only use proxies from these countries

behavior:
  profile: random            # human | bot | random
  mouse_movement: true       # Random mouse movements
  typing_speed_range: [30, 80]  # WPM range
  scroll_variance: 0.3       # Random scroll offset %

telegram:
  enabled: false
  bot_token: <YOUR_BOT_TOKEN>
  chat_id: <YOUR_CHAT_ID>
  notify_on_start: true
  notify_on_error: true
  daily_summary: true

recording:
  har: true                  # Capture HAR files
  screenshot: true           # Screenshot per session
  console_logs: true         # Capture browser console
  output_dir: ./sessions
```

### Keywords File Format

Create `keywords.txt`:
```
best SEO tools 2026
how to rank higher on Google
YouTube SEO tips
content marketing strategy
AI writing tools for bloggers
```

---

## 🧰 Usage Guide

### Desktop GUI

```bash
python main.py
```

| Step | Action |
|------|--------|
| 1 | Add proxies in the **Proxies** tab |
| 2 | Load or paste keywords in **Keywords** tab |
| 3 | Select search engines and behavior profile |
| 4 | Configure scheduling (immediate / scheduled / burst) |
| 5 | Click **Start** to launch traffic |
| 6 | Monitor real-time stats in **Dashboard** |
| 7 | Review session recordings in **History** tab |

---

## 💻 CLI Commands

```bash
# Run a single batch from command line
python main.py --headless --keywords keywords.txt --engines google,bing --sessions 50

# Run with specific proxy pool
python main.py --headless --proxies proxies.txt --rotation random

# Run with Telegram alerts
python main.py --headless --telegram --token BOT_TOKEN --chat CHAT_ID

# Generate keyword variations
python main.py --spin --input keywords.txt --output expanded.txt --variations 3

# Test proxy pool before running
python main.py --test-proxies proxies.txt --timeout 5 --threads 20

# Run in burst mode (N sessions simultaneously)
python main.py --burst 5 --keywords keywords.txt

# Schedule daily at 9 AM
python main.py --schedule daily --time 09:00 --keywords keywords.txt
```

---

## 🌐 Proxy Management

Supported formats (one per line in `proxies.txt`):
```
http://user:pass@1.2.3.4:8080
socks5://1.2.3.4:1080
1.2.3.4:3128  (auto-detected as HTTP)
```

### Proxy Features
- **Health Check** — Tests connectivity + anonymity before each session
- **Geo Filtering** — Only use proxies from specific countries
- **Auto-Removal** — Removes dead proxies after N consecutive failures
- **Performance Scoring** — Ranks proxies by speed and reliability
- **Sticky Sessions** — Same proxy for N sessions before rotating

---

## 🔍 Search Engines

| Engine | URL | Supported | Notes |
|--------|-----|-----------|-------|
| Google | google.com | ✅ Full | Supports region, language, safe search params |
| Bing | bing.com | ✅ Full | Supports market, language params |
| DuckDuckGo | duckduckgo.com | ✅ Full | Privacy mode enabled by default |
| Yahoo | search.yahoo.com | ✅ Basic | Limited parameter support |
| Yandex | yandex.com | ❌ Planned | Coming in v2.0 |
| Baidu | baidu.com | ❌ Planned | Coming in v2.0 |

---

## 🧑‍ Behavior Profiles

| Profile | Mouse | Typing | Scrolling | Clicks | Use Case |
|---------|-------|--------|-----------|--------|----------|
| **Human** | Natural curves | Variable WPM | Random depth | 1-3 organic results | Realistic traffic |
| **Bot** | None | Fast uniform | None | None | High-volume testing |
| **Random** | Mixed | Mixed | Mixed | Mixed | Unpredictable patterns |

### Custom Behaviors

You can also script custom behavior in `behaviors/custom.py`:

```python
class CustomBehavior:
    def on_page_load(self, driver):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(random.uniform(1, 3))

    def on_search(self, driver, keyword):
        # Custom search interaction
        pass
```

---

## 📡 Telegram Integration

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your Chat ID (use @userinfobot)
3. Add to `config.yaml`:

```yaml
telegram:
  enabled: true
  bot_token: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
  chat_id: -123456789
  notify_on_start: true
  notify_on_error: true
  daily_summary: true
  summary_time: "23:00"
```

### Notification Examples

```
🤖 Traffic Bot Report
━━━━━━━━━━━━━━━━━━
📅 Date: 2026-06-01
✅ Sessions: 47/50
❌ Errors: 3
🌐 Proxies used: 12
⏱ Avg session: 28.4s
📊 Completed: 94%
```

---

## 📊 Performance

| Metric | Value |
|--------|-------|
| Max concurrent sessions | 10 (configurable) |
| RAM per session | ~150 MB |
| Avg session time | 20-40s (depends on proxy + behavior) |
| Max sessions/hour (1 proxy) | ~90 |
| Max sessions/hour (10 proxies) | ~900 |
| Storage per 1000 sessions | ~200 MB (HAR + screenshots) |

---

## 🖼 Screenshots

> *(Screenshots coming soon. PRs welcome!)*

| Dashboard | Proxy Manager | Session History |
|-----------|--------------|-----------------|
| ![Dashboard](.github/screenshots/dashboard.png) | ![Proxies](.github/screenshots/proxies.png) | ![History](.github/screenshots/history.png) |

---

## 🔄 Roadmap

- 🟢 Yandex + Baidu search engine support
- 🟡 Mobile user-agent profiles (Chrome mobile, Safari iOS)
- ⚫ CAPTCHA solving service integration (2Captcha, AntiCaptcha)
- ⚫ Web dashboard (FastAPI + React)
- ⚫ Docker deployment with proxy rotation service
- ⚫ ML-based behavior profile generator

---

## ❓ FAQ

### Is this detectable by Google?
Stealth mode + human behavior profiles make detection very difficult but not impossible. Always use quality residential proxies for best results.

### How many proxies do I need?
Minimum 5-10 for basic operation. For large campaigns (1000+ sessions/day), use 50+ proxies.

### Can I use free proxies?
Free proxies work but have low reliability and speed. Residential or datacenter proxies are recommended.

### Does it work with headless mode?
Yes — headless mode is fully supported and recommended for production use.

### What happens when a proxy fails?
The bot automatically rotates to the next healthy proxy. After N failures, the proxy is removed from the pool.

### Is this legal?
Traffic bot is designed for **SEO testing and analytics validation** on your own websites. Always comply with target websites' ToS.

---

## 🚧 Troubleshooting

| Problem | Solution |
|---------|----------|
| **Chrome not found** | Install Google Chrome or set `CHROME_PATH` env variable |
| **Proxy connection failed** | Test proxy: `python main.py --test-proxies proxies.txt` |
| **Selenium driver error** | Run `pip install --upgrade selenium undetected-chromedriver` |
| **No search results** | Check geo parameter; some engines block foreign traffic |
| **High error rate** | Reduce concurrency; increase cooldown time; use better proxies |
| **Telegram not working** | Verify bot token and chat ID; check internet connection |
| **Memory usage high** | Reduce `--burst` count; close unused browser windows |
| **Sessions too fast** | Increase `cooldown_range` and enable human behavior profile |

### Debug Mode

```bash
python main.py --debug --log-level DEBUG
# Logs written to logs/traffic-bot-YYYY-MM-DD.log
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/zougar99/traffic-bot.git
cd traffic-bot
pip install -r requirements-dev.txt
python -m pytest tests/
```

---

## 📐 License

Distributed under the **MIT License**. See [`LICENSE`](https://github.com/zougar99/traffic-bot/blob/main/LICENSE) for more information.

---

<p align="center">
  Made with 📡 and ❤️ by <a href="https://github.com/zougar99">zougar99</a>
</p>
