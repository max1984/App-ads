// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import App from '../App.jsx'

beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false }))
  // Node 25 ships an incomplete global localStorage that shadows jsdom's — use an in-memory stub.
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

const typeInput = (text) =>
  fireEvent.change(screen.getByLabelText('app-ads.txt input'), { target: { value: text } })

describe('App', () => {
  it('shows the empty state before any input', () => {
    render(<App />)
    expect(screen.getByText('Cleaned output appears here')).toBeTruthy()
  })

  it('validates on Validate click and shows cleaned output with a health badge', () => {
    render(<App />)
    typeInput('OWNERDOMAIN=example.com\nGoogle.com, pub-1, direct')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    expect(screen.getByLabelText('Cleaned output').value)
      .toBe('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, f08c47fec0942fa0')
    expect(screen.getByTitle(/File quality score/).textContent).toBe('A100')
  })

  it('offers an Apply fix for cert mismatches and applies it', () => {
    render(<App />)
    typeInput('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, c3e20eee3f780d68')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /Apply fix/i })[0])
    expect(screen.getByLabelText('app-ads.txt input').value)
      .toBe('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, f08c47fec0942fa0')
  })

  it('ignores a stale Apply fix click if the input shifted before the debounced re-validation caught up', () => {
    vi.useFakeTimers()
    render(<App />)
    typeInput('OWNERDOMAIN=example.com\ngoogle.com, pub-1, DIRECT, c3e20eee3f780d68')
    act(() => { vi.advanceTimersByTime(300) })
    const applyBtn = screen.getAllByRole('button', { name: /Apply fix/i })[0]

    // Edit again, inserting a line before the issue — debounce is now pending,
    // so the Apply fix button above still reflects the stale pre-edit text.
    const shifted = 'OWNERDOMAIN=example.com\nNEW LINE\ngoogle.com, pub-1, DIRECT, c3e20eee3f780d68'
    typeInput(shifted)
    fireEvent.click(applyBtn)

    expect(screen.getByLabelText('app-ads.txt input').value).toBe(shifted)
  })

  it('does not let a pending debounced validation repopulate the output after Clear', () => {
    vi.useFakeTimers()
    render(<App />)
    // handleInputChange's 300ms debounce is now pending (result is still
    // null — nothing has re-validated yet).
    typeInput('google.com, pub-1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    act(() => { vi.advanceTimersByTime(300) })

    expect(screen.getByLabelText('app-ads.txt input').value).toBe('')
    expect(screen.getByText('Cleaned output appears here')).toBeTruthy()
  })

  it('shows an inline message instead of alert() when the file is too large to share', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<App />)
    typeInput('x'.repeat(80000))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share' })) })
    expect(screen.getByText('⚠ Too large to share')).toBeTruthy()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it(
    "regression: a stale timer from an earlier Share click doesn't erase a later click's still-valid status " +
      "message — 'copied' auto-clears after 2s but 'failed'/'too-large' get 4s (so the failure stays visible " +
      'longer); clicking Share again while the FIRST click\'s 2s timer is still pending armed a second, ' +
      "independent 4s timer for the new status, but the stale first timer still fired unconditionally and wiped " +
      'whatever status was current at that moment, not only the one it was originally armed for',
    async () => {
      vi.useFakeTimers()
      // jsdom has no execCommand at all (not even a stub returning false) —
      // document.execCommand is undefined, so the real implementation would
      // throw TypeError on a bare call. Stub it fresh per assertion.
      let execResult = true
      document.execCommand = vi.fn(() => execResult)
      render(<App />)
      typeInput('google.com, pub-1, DIRECT')
      const shareBtn = screen.getByRole('button', { name: 'Share' })

      // First click succeeds — "Copied!", 2s display — armed at t=0, fires at t=2000.
      execResult = true
      await act(async () => { fireEvent.click(shareBtn) })
      expect(shareBtn.textContent).toContain('Copied')

      // Before that 2s timer fires, a second click fails — "Copy failed", 4s
      // display — armed at t=1000, should stay visible until t=5000.
      act(() => { vi.advanceTimersByTime(1000) })
      execResult = false
      await act(async () => { fireEvent.click(shareBtn) })
      expect(shareBtn.textContent).toContain('Copy failed')

      // The first click's stale timer fires now (t=2000 total) — it must not
      // wipe the second click's still-valid "Copy failed" message 3s early.
      act(() => { vi.advanceTimersByTime(1000) })
      expect(shareBtn.textContent).toContain('Copy failed')
    }
  )
})

describe('App — accessibility', () => {
  it('exposes expanded state on collapsible toggles', () => {
    render(<App />)
    const batch = screen.getByRole('button', { name: /Batch URL check/ })
    expect(batch.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(batch)
    expect(batch.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders a missing network coverage item as a real button, not a bare clickable div', () => {
    render(<App />)
    typeInput('google.com, pub-1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    fireEvent.click(screen.getByRole('button', { name: /Network Coverage/ }))
    // google.com is present (first in TOP_NETWORKS); appnexus.com is not —
    // only the missing ones are interactive (click to copy a template line).
    expect(screen.getByRole('button', { name: /AppNexus/ })).toBeTruthy()
  })

  it('exposes an issue\'s "jump to line" link as a real nested button, and its parent toggle as a keyboard-operable role=button', () => {
    render(<App />)
    typeInput('OWNERDOMAIN=a.com\nfoo.com, 1')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    // The outer toggle can't be a real <button> because it has to contain
    // this "jump to line" button, and <button> forbids interactive/tabindex
    // descendants — so the toggle is a role="button" div instead.
    const jumpLink = screen.getByTitle('Jump to this line in the editor')
    expect(jumpLink.tagName).toBe('BUTTON')
    const issueTop = jumpLink.closest('[role="button"]')
    expect(issueTop.getAttribute('tabindex')).toBe('0')
    expect(issueTop.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(issueTop, { key: 'Enter' })
    expect(issueTop.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('App — dark mode', () => {
  it('persists a manual dark mode toggle across remounts instead of reverting to the OS preference', () => {
    window.matchMedia = () => ({ matches: false }) // OS preference: light
    const { unmount } = render(<App />)
    fireEvent.click(screen.getByTitle('Switch to dark mode'))
    expect(document.documentElement.getAttribute('data-dark')).toBe('1')
    unmount()

    render(<App />)
    expect(document.documentElement.getAttribute('data-dark')).toBe('1')
    expect(screen.getByTitle('Switch to light mode')).toBeTruthy()
  })
})

describe('App — gutter', () => {
  it('renders one line number per input line and highlights error lines', () => {
    const { container } = render(<App />)
    typeInput('OWNERDOMAIN=a.com\nfoo.com, 1\nbar.com, 2, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    const inputGutter = container.querySelector('.gutter')
    expect([...inputGutter.children].map(d => d.textContent)).toEqual(['1', '2', '3'])
    expect(inputGutter.children[1].className).not.toBe('gutter-line ')
  })
})
