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

Pushes to `main` that touch `site/**` trigger `.github/workflows/pages.yml`,
which publishes the `site/` folder to GitHub Pages:

**https://zougar99.github.io/traffic-bot/**

The workflow needs **Settings → Pages → Source = GitHub Actions** (one-time).

## Editing notes

- Colors, spacing and radii live in the `:root` token block at the top of `styles.css`.
- Sections in `index.html` are in reading order and each one carries a `.reveal` class for scroll animation.
- The "Live lab" simulator in `script.js` is a self-contained model: it never performs network calls.
- The GitHub star counter calls the public GitHub API once per hour and caches the result in `localStorage`; it fails silently offline.
