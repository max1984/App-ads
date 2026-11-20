// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen, act, cleanup } from '@testing-library/react'
import App from '../App'
import * as urlMod from '../url'

// Each batch-URL completion calls setBatchResults(prev => [...prev, ...]) —
// with an un-memoized BatchResultRow (and the old inline onLoad, which got a
// new function identity every update and defeated memo() on its own), that
// turned "update 1 of N rows" into "re-render all N rows", for each of the N
// completions: O(n^2) render work for a batch that should cost O(n). Timing
// a single batch size is too machine-dependent to assert on directly, so
// this compares the SAME run's small-vs-4x-larger batch against each other:
// true O(n) scaling keeps the ratio near 4 (plus fixed overhead), while the
// pre-fix O(n^2) behavior pushed it past 9 consistently (measured 9.4-9.5
// across repeated runs before this fix, vs. 5.0-5.4 after).
async function runBatch(n) {
  const urls = Array.from({ length: n }, (_, i) => `https://example${i}.com/app-ads.txt`)
  const resolvers = []
  vi.spyOn(urlMod, 'fetchFromUrl').mockImplementation(() => new Promise(res => { resolvers.push(res) }))

  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
  fireEvent.change(document.querySelector('.batch-textarea'), { target: { value: urls.join('\n') } })
  fireEvent.click(screen.getByRole('button', { name: /Check all URLs/ }))
  await act(async () => { await Promise.resolve() })

  const t0 = performance.now()
  let resolvedCount = 0
  while (resolvedCount < n) {
    const batch = resolvers.splice(0, resolvers.length)
    if (batch.length === 0) { await act(async () => { await Promise.resolve() }); continue }
    batch.forEach(r => r('owner,123,DIRECT\n'))
    resolvedCount += batch.length
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }
  return performance.now() - t0
}

describe('batch URL check — rendering scales with batch size, not its square', () => {
  it('a 4x larger batch takes roughly 4x as long, not ~16x', async () => {
    const small = await runBatch(150)
    cleanup()
    const large = await runBatch(600)
    expect(large / small).toBeLessThan(7.5)
  }, 60000)
})
