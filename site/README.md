# Traffic Bot — website (v2)

Static marketing site for the Traffic Bot desktop app. Plain HTML, CSS and JavaScript — no build step, no dependencies, no cookies.

```
site/
├── index.html        # single-page site
├── styles.css        # design tokens, themes, components
├── script.js         # interactions, hero console, timeline, live lab
├── robots.txt
├── sitemap.xml
└── assets/
    ├── icon.svg      # app mark (favicon + logo)
    ├── logo.svg      # wordmark
    └── og-card.png   # social preview 1200×630
```

## What's on the page

| Section | Interaction |
|---------|-------------|
| Hero | live "session console" that streams simulated proxy events |
| Features | 9-tile bento grid with a proxy pool mini-table |
| Modes | Direct / Google / Proxy tabs with per-mode flow and CLI hint |
| Session | 5-stage timeline that plays while in view |
| Live lab | simulator: sessions, pool size, pause, mode, success chart |
| Telegram | chat mock with `/run`, `/status`, checkpoints |
| Install | tabbed snippets with copy-to-clipboard |
| Roadmap / FAQ / CTA | static with reveal-on-scroll |

## Design system

- Tokens in `:root` (`styles.css`) — colours, radii, spacing, motion.
- **Two themes**: dark (default) and light, driven by `html[data-theme]`.
  The choice is stored in `localStorage` under `tb:theme` and falls back to
  `prefers-color-scheme`. A tiny inline script applies it before first paint.
- Typography: Space Grotesk (display), Inter (body), JetBrains Mono (code/UI labels).
- Motion respects `prefers-reduced-motion`; the timeline and console freeze to a
  static state.

## Local preview

```bash
python3 -m http.server 4180 --directory site
# → http://localhost:4180
```

The app also exposes it through npm:

```bash
npm run site
```

## Deploy

Pushes to `main` that touch `site/**` (or a manual *Run workflow*) trigger
`.github/workflows/pages.yml`, which publishes this folder to the `gh-pages`
branch using the workflow token — no build step, no Pages permission needed.

**One-time step (owner only):** GitHub does not serve a `gh-pages` branch until
Pages is switched on for the repository.

1. Open <https://github.com/zougar99/traffic-bot/settings/pages>
2. **Source** → *Deploy from a branch*
3. **Branch** → `gh-pages` · folder `/ (root)` → **Save**

After a minute the site is live at **https://zougar99.github.io/traffic-bot/**
(deploys after that are fully automatic).

> Why not `actions/deploy-pages`? That flow requires *Settings → Pages → Source:
> GitHub Actions* **and** the `pages: write` permission; the branch flow keeps the
> workflow runnable from forks and from tokens without Pages scope.

## Editing notes

- The only network request at runtime is the GitHub star count
  (`api.github.com`), cached for one hour and silently skipped if offline.
- The live lab never leaves the browser; it is a deterministic-ish model, not a runner.
- Simulated IPs and timings are placeholders — do not read them as benchmarks.
