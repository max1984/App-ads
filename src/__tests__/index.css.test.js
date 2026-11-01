import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Regression test for a dark-mode gap: native form controls (checkboxes,
// scrollbars, <select> arrows) are rendered by the browser's own UA
// stylesheet and, unless the page declares `color-scheme`, they ignore the
// app's manual dark/light toggle (App.jsx's `data-dark` attribute) and
// instead silently follow the OS/browser's own light/dark preference. That
// produces a visibly broken widget (e.g. a light checkbox on a dark panel)
// whenever a user's OS preference disagrees with the toggle they picked in
// this app. There's no jsdom/computed-style test precedent in this repo for
// pure-CSS rules, so — like the earlier `.editor:focus`/`.batch-textarea:focus`
// CSS-only fix — this reads the stylesheet source directly.
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf-8')

describe('index.css — color-scheme follows the manual dark-mode toggle', () => {
  it('declares a light color-scheme on :root', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(rootBlock).toMatch(/color-scheme:\s*light\s*;/)
  })

  it('declares a dark color-scheme inside the [data-dark] override block', () => {
    const darkBlock = css.match(/\[data-dark\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(darkBlock).toMatch(/color-scheme:\s*dark\s*;/)
  })
})
