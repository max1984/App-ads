# app-ads.txt Validator

Validates, deduplicates and fixes `app-ads.txt` files per the IAB Tech Lab spec.

**Live:** https://max1984.github.io/App-ads/

## Features

- Record validation: domain, publisher ID, relationship, TAG cert ID (format, registry, cross-company mismatch)
- Auto-fixes: case normalization, scheme/path stripped from domains, missing cert IDs filled from a known registry, duplicates removed, CRLF normalized
- Variables: `OWNERDOMAIN`, `MANAGERDOMAIN`, `CONTACT`, `SUBDOMAIN`, `INVENTORYPARTNERDOMAIN`
- Inline `#` comments preserved
- Health score (0–100, A–F), top-network coverage, change diff
- Load from URL (bare domain → `https://domain/app-ads.txt`), batch URL check with CSV export
- Local version history with diff, share links, dark mode

## Development

Requires Node 22+.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest: validator unit tests + App component tests (jsdom)
npm run build    # production build → dist/
```

Pushing to `main` runs tests, builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Project layout

| Path | Purpose |
|------|---------|
| `src/validator.js` | Parsing, validation, fixes, snapshot diff, health score |
| `src/url.js` | URL normalization and fetching (CORS proxy fallback, HTML soft-404 detection) |
| `src/share.js` | Share-link encoding, clipboard helper |
| `src/output.js` | Output sorting |
| `src/batch.js` | Batch summary and CSV export |
| `src/App.jsx` | UI |
| `src/__tests__/` | Tests |

## Legacy desktop app

`main.py` / `validator.py` are an older Tkinter desktop version (`poetry install && python main.py`, or via `Dockerfile`). The web app is the maintained version.
