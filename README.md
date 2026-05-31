# WGTB — Web Growth Traffic Bot

**Developer:** [@werlist99](https://t.me/werlist99) on Telegram.

Desktop **traffic lab**: controlled Chrome sessions via Selenium, rotating proxies, optional Google/proxy search flows, and Telegram notifications. Built with Electron.

---

## Features

- **Session runs:** Direct visits, Google search path, or proxy gateway mode.
- **Proxies & identity:** Rotate HTTP proxies; optional email list rotation.
- **Engagement hooks:** Optional scroll / like / comment flows (site-dependent).
- **Telegram:** Remote commands and desktop-run notifications (`telegram.config.json`).

---

## Tech stack

- Node.js · Electron · Selenium WebDriver · ChromeDriver · Telegraf (optional)

---

## Prerequisites

- **Node.js** 18+ recommended.
- **Google Chrome** installed; **ChromeDriver** major version must match Chrome (`npm install chromedriver@latest` after Chrome updates).

---

## Install & run

```bash
cd google-traffic-bot
npm install
npm start
```

Telegram test (same channel as in-app notifications):

```bash
npm run test:telegram
```

---

## Disclaimer

**Educational use only.** Respect site terms and applicable laws. The authors are not responsible for misuse.

---

## License

ISC (see `package.json`).
