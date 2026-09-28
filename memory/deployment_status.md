---
name: deployment-status
description: GitHub Pages deployment setup and current status
metadata:
  type: project
---

**Deployment target:** GitHub Pages via GitHub Actions

**Workflow file:** `.github/workflows/deploy.yml` — triggers on push to `main` or manual `workflow_dispatch`

**Build:** `npm ci && npm run build` → outputs to `dist/` → uploaded as Pages artifact

**Vite base:** `'./'` (relative paths — works for GitHub Pages project pages)

**Expected Pages URL:** `https://max1984.github.io/App-ads/`

**Session 1 (2026-06-25):**
- Explored project, saved initial memory notes
- Repo was clean, workflow already in place
- No code changes made

**Session 2 (2026-06-25):**
- Full QA pass — fixed 5 bugs in validator.js, rewrote App.jsx and all CSS
- Pushed commit 5e105b1 to main → GitHub Actions deploy triggered
- Build confirmed clean (vite build passed, 166KB JS bundle)

**What was shipped in session 2:**
- BUG-01–05 all fixed (duplicate key, publisher ID case, variable detection, cert normalization, Line 0)
- Stricter TAG cert ID validation (exactly 16 hex chars)
- Auto-validate on paste (300ms debounce)
- Ctrl/Cmd+Enter keyboard shortcut
- Click issue line number → scroll editor to that line
- URL breadcrumb after loading from URL
- Expand all / Collapse all buttons for issues
- Dark mode toggle (respects system preference on load)
- Share link via URL hash (base64 encoded)
- Sort A–Z toggle on output panel
- Export JSON button
- DIRECT / RESELLER breakdown in stats
- Network coverage panel (top 20 networks, collapsible)
- All colours moved to CSS custom properties for dark mode support

**Why:** User wants the app deployed on GitHub Pages; every session's changes should be pushed to main.

**How to apply:** After any code change, commit + push to main. The workflow auto-deploys. Check https://max1984.github.io/App-ads/ to verify.
