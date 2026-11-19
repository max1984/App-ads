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

// Regression test for a contrast gap: the severity `--*-color` custom
// properties are rendered as text (gutter markers, badges, stat counts,
// diff tags) directly on top of their matching `--*-bg` chip, at sizes
// (11-13px) well under WCAG's "large text" cutoff. A color pair that looks
// fine to the eye can still fail the 4.5:1 minimum the spec requires for
// normal-size text — this reads the actual hex values out of the
// stylesheet (not a hardcoded snapshot) so any future edit to either half
// of a pair is checked against the real formula, not just eyeballed.
// https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

function channelLuminance(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hexToRgb(hex1))
  const l2 = relativeLuminance(hexToRgb(hex2))
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

function readVar(block, name) {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`--${name} not found in block`)
  return match[1]
}

describe('index.css — severity text colors meet WCAG AA contrast on their chip background', () => {
  const rootBlock = css.match(/:root\s*\{([^}]*)\}/s)?.[1] ?? ''
  const darkBlock = css.match(/\[data-dark\]\s*\{([^}]*)\}/s)?.[1] ?? ''
  const severities = ['error', 'warning', 'dupe', 'filled', 'success']

  it.each(severities)('light mode: %s text meets 4.5:1 against its chip background', (name) => {
    const fg = readVar(rootBlock, `${name}-color`)
    const bg = readVar(rootBlock, `${name}-bg`)
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(severities)('dark mode: %s text meets 4.5:1 against its chip background', (name) => {
    const fg = readVar(darkBlock, `${name}-color`)
    const bg = readVar(darkBlock, `${name}-bg`)
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
})
