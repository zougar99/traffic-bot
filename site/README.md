# Traffic Bot — website

Static marketing site for the Traffic Bot desktop app. Plain HTML, CSS and JavaScript — no build step, no dependencies.

```
site/
├── index.html          # single-page site
├── styles.css          # design system + layout
├── script.js           # interactions, live lab simulator
├── robots.txt
├── sitemap.xml
└── assets/
    ├── icon.svg        # app mark (favicon, logo)
    ├── logo.svg        # wordmark
    └── og-card.png     # social preview image (1200×630)
```

## Local preview

```bash
python3 -m http.server 4180 --directory site
# → http://localhost:4180
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

- Colors, spacing and radii live in the `:root` token block at the top of `styles.css`.
- Sections in `index.html` are in reading order and each one carries a `.reveal` class for scroll animation.
- The "Live lab" simulator in `script.js` is a self-contained model: it never performs network calls.
- The GitHub star counter calls the public GitHub API once per hour and caches the result in `localStorage`; it fails silently offline.
