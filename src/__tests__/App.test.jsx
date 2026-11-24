// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import App from '../App.jsx'
import * as urlModule from '../url.js'

vi.mock('../url.js', async () => {
  const actual = await vi.importActual('../url.js')
  return { ...actual, fetchFromUrl: vi.fn() }
})

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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  // Without this, vi.spyOn(window, 'alert'/'confirm'/'prompt') in one test
  // reuses the SAME mock (and its accumulated call history) the next time
  // any later test spies on the same global, since spyOn on an
  // already-spied method doesn't start a fresh mock. That silently
  // inflated an unrelated later test's toHaveBeenCalledTimes() count by
  // whatever an earlier test's spy had already recorded — caught once via
  // a local alertSpy.mockClear() in two tests, but the root cause (no
  // restore between tests) was still live for every other spy here.
  vi.restoreAllMocks()
  // Same class of gap as the alert/confirm/prompt spies just above, for the
  // module-level fetchFromUrl mock created by vi.mock() at the top of this
  // file: vi.restoreAllMocks() only restores spies created via vi.spyOn()
  // (it reinstates their ORIGINAL implementation) — a plain vi.fn(), which
  // has no "original" to restore to, is left completely untouched, queued
  // once-implementations and all. A test that queues a mockRejectedValueOnce()/
  // mockResolvedValueOnce() and deliberately never consumes it (e.g. "ignores a
  // second Enter press..." below, which asserts fetchFromUrl was called only
  // once and leaves the second queued result unused on purpose) used to leak
  // that queued value into whichever LATER test called fetchFromUrl() first —
  // getting a result neither test configured, purely because of file order.
  // This was previously patched locally, once, at the one call site that
  // happened to trip over it (see the old comment removed from that test) —
  // resetting here instead closes the gap for every test, present and future.
  urlModule.fetchFromUrl.mockReset()
})

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
    // The title tooltip above isn't reliably read by screen readers and isn't
    // reachable at all without a mouse — aria-label is what actually makes the
    // bare "A100" visual text accessible.
    expect(screen.getByLabelText('File quality score: grade A, 100 out of 100')).toBeTruthy()
  })

  it(
    'announces the validation stats row to screen readers via aria-live, since it ' +
      'updates on a 300ms debounce as the user types and sighted users get no other cue',
    () => {
      render(<App />)
      typeInput('OWNERDOMAIN=example.com\nGoogle.com, pub-1, direct')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      const statsRow = screen.getByRole('status')
      expect(statsRow.getAttribute('aria-live')).toBe('polite')
      expect(statsRow.textContent).toContain('records')
    }
  )

  it(
    'defers revoking the download blob URL instead of revoking it synchronously ' +
      "right after the click — some browsers read the blob asynchronously, so an " +
      'immediate revoke can race the read and silently abort the download',
    () => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      // jsdom doesn't honor the `download` attribute and tries to actually
      // navigate a real anchor click (which it then can't do for a blob:
      // URL) — irrelevant to what this test checks, so skip it.
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      render(<App />)
      typeInput('OWNERDOMAIN=example.com\nGoogle.com, pub-1, direct')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Download .txt' }))
      expect(revokeSpy).not.toHaveBeenCalled()
      return new Promise(resolve => setTimeout(() => {
        expect(revokeSpy).toHaveBeenCalledWith('blob:fake')
        resolve()
      }, 0))
    }
  )

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

  it(
    'disables Share for an empty input instead of leaving it clickable to copy an empty link — ' +
      "buildShareUrl's own error === 'empty' branch inside handleShare mirrors this `disabled` " +
      "prop exactly, which makes that internal branch unreachable through the real UI (same " +
      'defense-in-depth class as other already-documented unreachable fallbacks in this file)',
    () => {
      render(<App />)
      expect(screen.getByRole('button', { name: 'Share' }).disabled).toBe(true)

      typeInput('a.com, 1, DIRECT')
      expect(screen.getByRole('button', { name: 'Share' }).disabled).toBe(false)
    }
  )

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

  it(
    "regression: a stale timer from an earlier Copy click doesn't hide a later click's " +
      "'Copied!' flash early — clicking Copy again within the first click's 2s window used to " +
      "arm a second, independent timer without clearing the first, so the first still fired at " +
      "its own t=2000 and hid the flash 1s before the second click's own 2s was up",
    async () => {
      vi.useFakeTimers()
      // navigator.clipboard is undefined in jsdom, so copyText() falls back
      // to execCommand — same stub as the Share regression test above.
      document.execCommand = vi.fn(() => true)
      render(<App />)
      typeInput('google.com, pub-1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      const copyBtn = screen.getByRole('button', { name: 'Copy' })

      // First click at t=0 — fires at t=2000.
      await act(async () => { fireEvent.click(copyBtn) })
      expect(copyBtn.textContent).toContain('Copied')

      // Second click at t=1000 — should keep the flash until t=3000.
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.click(copyBtn) })
      expect(copyBtn.textContent).toContain('Copied')

      // The first click's stale timer fires now (t=2000 total) — must not
      // hide the second click's still-valid flash 1s early.
      act(() => { vi.advanceTimersByTime(1000) })
      expect(copyBtn.textContent).toContain('Copied')
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

  it(
    'announces "Copied!" feedback to screen readers on the Copy-output and ' +
      'missing-network-template buttons, matching the Share button\'s existing aria-live',
    () => {
      render(<App />)
      typeInput('google.com, pub-1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      expect(screen.getByRole('button', { name: 'Copy' }).getAttribute('aria-live')).toBe('polite')
      fireEvent.click(screen.getByRole('button', { name: /Network Coverage/ }))
      expect(screen.getByTitle(/AppNexus/).getAttribute('aria-live')).toBe('polite')
    }
  )

  it(
    'exposes the issue filter tabs as a labelled group with aria-pressed on the active one, ' +
      'matching the Compare button\'s own aria-pressed fix — "active" there was a CSS class only, ' +
      'with no indication to a screen reader of which filter (All/Errors/Warnings/…) is selected',
    () => {
      render(<App />)
      typeInput('google.com, pub-1, DIRECT\nbad-line-with-no-commas')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))

      const group = screen.getByRole('group', { name: 'Filter issues by type' })
      const allTab = screen.getByRole('button', { name: /^All/ })
      expect(group.contains(allTab)).toBe(true)
      expect(allTab.getAttribute('aria-pressed')).toBe('true')

      const errorTab = screen.getByRole('button', { name: /^Errors/ })
      expect(errorTab.getAttribute('aria-pressed')).toBe('false')

      fireEvent.click(errorTab)
      expect(errorTab.getAttribute('aria-pressed')).toBe('true')
      expect(allTab.getAttribute('aria-pressed')).toBe('false')
    }
  )

  it(
    'regression: the URL loader input has an accessible name of its own, not just a ' +
      'placeholder — every other text input/textarea in this app (the main editor, the ' +
      'cleaned-output editor, the batch-URLs textarea) has an aria-label, but this one relied ' +
      "solely on placeholder text, which disappears once typing starts and isn't a reliable " +
      'accessible-name source for screen readers',
    () => {
      render(<App />)
      expect(screen.getByRole('textbox', { name: /app-ads\.txt URL/i })).toBeTruthy()
    }
  )

  it('renders a missing network coverage item as a real button, not a bare clickable div', () => {
    render(<App />)
    typeInput('google.com, pub-1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    fireEvent.click(screen.getByRole('button', { name: /Network Coverage/ }))
    // google.com is present (first in TOP_NETWORKS); appnexus.com is not —
    // only the missing ones are interactive (click to copy a template line).
    expect(screen.getByRole('button', { name: /AppNexus/ })).toBeTruthy()
  })

  it(
    "regression: a stale timer from copying one missing network's template doesn't erase a later copy's still-" +
      "valid \"copied!\" badge on a DIFFERENT network — copiedNetwork is ONE state value shared by every coverage " +
      "item, not one per item; copying AppNexus's template arms a 2s clear-timer, and copying Rubicon's 1s later " +
      "(while AppNexus's \"copied!\" is still showing) overwrote the value to Rubicon's domain and armed a SECOND, " +
      "independent 2s timer, but AppNexus's stale (earlier) timer still fired unconditionally at its own t=2000 " +
      "and wiped Rubicon's still-valid badge a full second early",
    async () => {
      vi.useFakeTimers()
      document.execCommand = vi.fn(() => true)
      render(<App />)
      typeInput('google.com, pub-1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      fireEvent.click(screen.getByRole('button', { name: /Network Coverage/ }))

      const appnexusBtn = screen.getByTitle(/AppNexus/)
      const rubiconBtn = screen.getByTitle(/Rubicon/)

      // Copy AppNexus's template at t=0 — its clear-timer is armed for t=2000.
      await act(async () => { fireEvent.click(appnexusBtn) })
      expect(appnexusBtn.textContent).toContain('copied!')

      // 1s later, copy Rubicon's — its own clear-timer is armed for t=3000.
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.click(rubiconBtn) })
      expect(rubiconBtn.textContent).toContain('copied!')

      // AppNexus's stale timer fires now (t=2000 total) — it must not wipe
      // Rubicon's still-valid "copied!" badge a full second before Rubicon's
      // own 2s is up.
      act(() => { vi.advanceTimersByTime(1000) })
      expect(rubiconBtn.textContent).toContain('copied!')
    }
  )

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

  it(
    "pressing a non-activating key (e.g. Tab) on the issue-top div itself must NOT toggle it — " +
      'the only existing keyboard test used Enter, so the `e.key !== \'Enter\' && e.key !== \' \'` ' +
      'early-return guard had never actually been taken',
    () => {
      render(<App />)
      typeInput('OWNERDOMAIN=a.com\nfoo.com, 1')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      const jumpLink = screen.getByTitle('Jump to this line in the editor')
      const issueTop = jumpLink.closest('[role="button"]')
      expect(issueTop.getAttribute('aria-expanded')).toBe('true')

      fireEvent.keyDown(issueTop, { key: 'Tab' })

      expect(issueTop.getAttribute('aria-expanded')).toBe('true')
    }
  )

  it(
    'regression: pressing Enter/Space while focus is on the nested "jump to line" button must ' +
      "NOT also toggle the parent card — keydown bubbles from that real <button> up to the " +
      "outer role=button's onKeyDown, which used to fire unconditionally and both wrongly " +
      "toggled the card and (via preventDefault) suppressed the button's own native activation",
    () => {
      render(<App />)
      typeInput('OWNERDOMAIN=a.com\nfoo.com, 1')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      const jumpLink = screen.getByTitle('Jump to this line in the editor')
      const issueTop = jumpLink.closest('[role="button"]')
      expect(issueTop.getAttribute('aria-expanded')).toBe('true')

      fireEvent.keyDown(jumpLink, { key: 'Enter', bubbles: true })
      expect(issueTop.getAttribute('aria-expanded')).toBe('true')

      fireEvent.keyDown(jumpLink, { key: ' ', bubbles: true })
      expect(issueTop.getAttribute('aria-expanded')).toBe('true')
    }
  )

  it(
    'regression: clicking "jump to line" selects that line\'s text in the editor, not just ' +
      'scrolls to it — textarea.focus() alone restores whatever caret position the editor ' +
      'already had, which is NOT the jumped-to line, leaving a keyboard/AT user visually on ' +
      'the right line but editing the wrong one',
    () => {
      render(<App />)
      typeInput('OWNERDOMAIN=a.com\nfoo.com, 1')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      const jumpLink = screen.getByTitle('Jump to this line in the editor')
      fireEvent.click(jumpLink)

      const editor = screen.getByLabelText('app-ads.txt input')
      // Line 1 "OWNERDOMAIN=a.com" is 17 chars + 1 for the newline = offset 18.
      // Line 2 "foo.com, 1" is 10 chars, so the selection should span [18, 28).
      expect(editor.selectionStart).toBe(18)
      expect(editor.selectionEnd).toBe(28)
    }
  )

  it(
    'regression: the Changes panel\'s per-row "jump to line" button must announce which line it ' +
      'jumps to, not just echo the bare line number — its only visible text is the number itself ' +
      '(e.g. "2"), with the action explained only via title, same gap as the version-rename button ' +
      "and unlike its sibling in the Issues panel, which at least says \"Line 2\"",
    () => {
      render(<App />)
      typeInput('OWNERDOMAIN=example.com\nGoogle.com, pub-1, direct')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      // The Changes panel auto-opens (showDiff is set true) whenever there
      // are changes — no need to click its toggle, which would instead CLOSE it.

      expect(screen.queryByRole('button', { name: '2' })).toBeFalsy()
      expect(screen.getByRole('button', { name: 'Jump to line 2' })).toBeTruthy()
    }
  )

  it(
    'shows "removed" and "normalized" pills in the Changes panel summary, not just "certs added"',
    () => {
      render(<App />)
      // Line 1 (a domain with no known network/cert): lowercase 'direct'
      // normalized to DIRECT (1 normalized). Lines 2-3: an already-clean,
      // byte-identical pair, so the second is removed as a duplicate (1
      // removed). Every existing test that produces changes only ever
      // triggered the cert-added pill (google.com IS a known network, so
      // its own case-fix is categorized as 'cert-added', not 'corrected').
      typeInput('bar.com, pub-1, direct\nfoo.com, pub-2, DIRECT\nfoo.com, pub-2, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))

      expect(screen.getByText(/1 removed/)).toBeTruthy()
      expect(screen.getByText(/1 normalized/)).toBeTruthy()
    }
  )

  it('toggles the Changes panel closed and back open on its own header button', () => {
    render(<App />)
    typeInput('google.com, pub-1, direct')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    // Auto-opened because there are changes — the toggle button itself has never
    // actually been clicked by any test (clicking it here CLOSES it first).
    expect(screen.getByRole('button', { name: 'Jump to line 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Changes/ }))
    expect(screen.queryByRole('button', { name: 'Jump to line 1' })).toBeFalsy()

    fireEvent.click(screen.getByRole('button', { name: /Changes/ }))
    expect(screen.getByRole('button', { name: 'Jump to line 1' })).toBeTruthy()
  })

  it('clicking the Changes panel\'s "Jump to line" button selects that line in the editor', () => {
    const line1 = 'a.com, 1, DIRECT'
    const line2 = 'bar.com, 2, direct'
    render(<App />)
    typeInput(`${line1}\n${line2}`)
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Jump to line 2' }))

    const editor = screen.getByLabelText('app-ads.txt input')
    expect(editor.selectionStart).toBe(line1.length + 1) // +1 for the newline
    expect(editor.selectionEnd).toBe(line1.length + 1 + line2.length)
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

  it(
    'regression: switching back to light mode removes the data-dark attribute entirely, not ' +
      "just empties its value — index.css's override selector is [data-dark], which matches " +
      'on attribute PRESENCE regardless of value, so leaving it set to \'\' kept dark styling ' +
      'applied and made the toggle look like it did nothing once clicked back to light',
    () => {
      window.matchMedia = () => ({ matches: false })
      render(<App />)
      fireEvent.click(screen.getByTitle('Switch to dark mode'))
      expect(document.documentElement.hasAttribute('data-dark')).toBe(true)

      fireEvent.click(screen.getByTitle('Switch to light mode'))
      expect(document.documentElement.hasAttribute('data-dark')).toBe(false)
    }
  )

  it(
    'falls back to the OS preference instead of crashing when reading the stored preference throws',
    () => {
      // Some browsers (private mode with storage fully disabled) throw on
      // localStorage access itself, not just return null — loadStoredDarkMode()
      // has a catch for exactly this, but nothing previously made getItem
      // actually throw to exercise it.
      vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
      window.matchMedia = () => ({ matches: true }) // OS preference: dark

      render(<App />)

      expect(document.documentElement.getAttribute('data-dark')).toBe('1')
    }
  )
})

describe('App — URL loader', () => {
  it('ignores a second Enter press while the first URL fetch is still in flight, instead of racing two fetches', async () => {
    let resolveFirst
    const first = new Promise(resolve => { resolveFirst = resolve })
    urlModule.fetchFromUrl
      .mockReturnValueOnce(first)
      .mockRejectedValueOnce(new Error('should not be called'))

    render(<App />)
    const urlInput = screen.getByPlaceholderText(/example.com/i)

    fireEvent.change(urlInput, { target: { value: 'first.com' } })
    fireEvent.keyDown(urlInput, { key: 'Enter' })

    // Fetch #1 is still pending — change the field and press Enter again.
    // Before the fix this started a second, fully concurrent fetchFromUrl().
    fireEvent.change(urlInput, { target: { value: 'second.com' } })
    fireEvent.keyDown(urlInput, { key: 'Enter' })

    expect(urlModule.fetchFromUrl).toHaveBeenCalledTimes(1)

    await act(async () => { resolveFirst('google.com, pub-1, DIRECT') })

    expect(screen.getByLabelText('app-ads.txt input').value).toBe('google.com, pub-1, DIRECT')
  })

  // Regression test for the leak the global afterEach's fetchFromUrl.mockReset()
  // now prevents (see that comment): the test just above deliberately queues a
  // mockRejectedValueOnce() it never consumes. Before that global reset existed,
  // whichever test ran next and called fetchFromUrl() for the first time got
  // THAT leftover rejection instead of whatever it configured itself — nothing
  // about this test's own setup would explain the failure, since the mock here
  // is never told to reject.
  it('is not affected by an earlier test leaving an unconsumed queued mock result behind', async () => {
    urlModule.fetchFromUrl.mockResolvedValue('google.com, pub-1, DIRECT')

    render(<App />)
    fireEvent.change(screen.getByPlaceholderText(/example.com/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => expect(screen.getByLabelText('app-ads.txt input').value).toBe('google.com, pub-1, DIRECT'))
  })

  it('clears the "Loaded from:" banner without clearing the editor content', async () => {
    urlModule.fetchFromUrl.mockResolvedValue('google.com, pub-1, DIRECT')
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText(/example.com/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(screen.getByText(/example\.com\/app-ads\.txt/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Clear loaded URL' }))

    expect(screen.queryByText('Loaded from:')).toBeFalsy()
    expect(screen.getByLabelText('app-ads.txt input').value).toBe('google.com, pub-1, DIRECT')
  })
})

describe('App — file loading', () => {
  it(
    'shows an error instead of silently doing nothing when reading the uploaded file fails',
    async () => {
      // loadFile()'s FileReader had no onerror — a failed read (permission
      // error, file removed between picking it and the read completing) left
      // onload never firing and nothing else reacting, so the "Upload file"
      // button/drop zone looked like it silently did nothing.
      const originalReadAsText = FileReader.prototype.readAsText
      FileReader.prototype.readAsText = function () { this.onerror?.() }

      try {
        render(<App />)
        const file = new File(['irrelevant'], 'broken.txt', { type: 'text/plain' })
        const fileInput = document.querySelector('input[type="file"][accept=".txt,text/plain"]')

        fireEvent.change(fileInput, { target: { files: [file] } })

        expect(await screen.findByText(/Failed to read broken\.txt/)).toBeTruthy()
      } finally {
        FileReader.prototype.readAsText = originalReadAsText
      }
    }
  )

  it(
    'clears the stale file-read error when Clear is clicked, instead of leaving it on screen indefinitely',
    async () => {
      // Clear already resets input/result/loadedUrl/sortOutput (see its own
      // "BUG-02 FIX" comment for sortOutput) — fileError, shown in the exact
      // same panel right above the editor, was the one piece of this panel's
      // own state it left behind, outliving the very upload it was about.
      const originalReadAsText = FileReader.prototype.readAsText
      FileReader.prototype.readAsText = function () { this.onerror?.() }
      try {
        render(<App />)
        const file = new File(['irrelevant'], 'broken.txt', { type: 'text/plain' })
        const fileInput = document.querySelector('input[type="file"][accept=".txt,text/plain"]')
        fireEvent.change(fileInput, { target: { files: [file] } })
        await screen.findByText(/Failed to read broken\.txt/)

        fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

        expect(screen.queryByText(/Failed to read broken\.txt/)).toBeNull()
      } finally {
        FileReader.prototype.readAsText = originalReadAsText
      }
    }
  )

  it(
    'clears the stale file-read error when the user types over it by hand, not just via Clear',
    async () => {
      // Clear (tested above) was the only other place fileError got reset
      // besides a successful loadFile() — simply typing new content into the
      // editor by hand, without ever clicking Clear, left the old "Failed to
      // read broken.txt" message sitting above the editor describing an
      // upload that no longer has anything to do with what's now in the box.
      const originalReadAsText = FileReader.prototype.readAsText
      FileReader.prototype.readAsText = function () { this.onerror?.() }
      try {
        render(<App />)
        const file = new File(['irrelevant'], 'broken.txt', { type: 'text/plain' })
        const fileInput = document.querySelector('input[type="file"][accept=".txt,text/plain"]')
        fireEvent.change(fileInput, { target: { files: [file] } })
        await screen.findByText(/Failed to read broken\.txt/)

        typeInput('google.com, pub-1, DIRECT')

        expect(screen.queryByText(/Failed to read broken\.txt/)).toBeNull()
      } finally {
        FileReader.prototype.readAsText = originalReadAsText
      }
    }
  )

  it(
    'keeps the last file dropped/selected even when its read resolves before an earlier one',
    async () => {
      // loadFile() had no generation guard — two FileReader reads in flight at
      // once (a second file dropped/selected while the first file's async
      // readAsText() is still pending) raced with no ordering guarantee:
      // whichever onload fired LAST won, even when that was the EARLIER
      // file's read finishing after the later, now-stale one.
      const pending = []
      const originalReadAsText = FileReader.prototype.readAsText
      FileReader.prototype.readAsText = function () { pending.push(this) }
      try {
        render(<App />)
        const fileInput = document.querySelector('input[type="file"][accept=".txt,text/plain"]')

        const first = new File(['first.com, pub-1, DIRECT'], 'first.txt', { type: 'text/plain' })
        fireEvent.change(fileInput, { target: { files: [first] } })
        const second = new File(['second.com, pub-2, DIRECT'], 'second.txt', { type: 'text/plain' })
        fireEvent.change(fileInput, { target: { files: [second] } })

        expect(pending).toHaveLength(2)
        // Resolve the SECOND (later) drop's read first, then the first/earlier
        // one — the out-of-order completion a race condition actually needs.
        pending[1].onload({ target: { result: 'second.com, pub-2, DIRECT' } })
        pending[0].onload({ target: { result: 'first.com, pub-1, DIRECT' } })

        await waitFor(() => expect(screen.getByLabelText('app-ads.txt input').value)
          .toBe('second.com, pub-2, DIRECT'))
      } finally {
        FileReader.prototype.readAsText = originalReadAsText
      }
    }
  )

  it(
    'rejects a file larger than the upload size limit before even trying to read it',
    async () => {
      // loadFile() had no size check at all — dropping/selecting an
      // unrelated multi-MB file fed its full content straight into
      // readAsText() and then validateAdsTxt(), with nothing stopping a
      // huge string from freezing the tab. A real app-ads.txt is a few KB.
      render(<App />)
      const fileInput = document.querySelector('input[type="file"][accept=".txt,text/plain"]')
      const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.txt', { type: 'text/plain' })

      fireEvent.change(fileInput, { target: { files: [big] } })

      expect(await screen.findByText(/"huge\.txt" is 5\.0 MB — larger than the 5 MB limit/)).toBeTruthy()
    }
  )

  it(
    'rejects a dropped binary file instead of loading it as unreadable text',
    async () => {
      // loadFile() had no content check either — an image, PDF, or other
      // binary file read via readAsText() decodes as UTF-8 regardless,
      // landing in the editor as unreadable mojibake with no indication
      // anything had gone wrong.
      render(<App />)
      const dropZone = screen.getByLabelText('app-ads.txt input')
      const bytes = new Uint8Array(200)
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
      const binary = new File([bytes], 'image.png', { type: 'image/png' })

      fireEvent.drop(dropZone, { dataTransfer: { files: [binary] } })

      expect(await screen.findByText(/"image\.png" doesn't look like a text file/)).toBeTruthy()
    }
  )

  it(
    "detects a binary file even without any NUL byte — looksLikeBinary's second heuristic " +
      '(too many replacement/control characters) — not just its NUL-byte shortcut, which the ' +
      'test above always hits first and so never exercises this one',
    async () => {
      render(<App />)
      const dropZone = screen.getByLabelText('app-ads.txt input')
      // 0xFF is never a valid UTF-8 lead byte, so readAsText() decodes every
      // byte as its own U+FFFD replacement character — no 0x00 anywhere,
      // so the NUL-byte shortcut above can't fire; this is the only way to
      // reach the suspicious-character-counting loop and its ratio check.
      const bytes = new Uint8Array(200).fill(0xff)
      const binary = new File([bytes], 'photo.jpg', { type: 'image/jpeg' })

      fireEvent.drop(dropZone, { dataTransfer: { files: [binary] } })

      expect(await screen.findByText(/"photo\.jpg" doesn't look like a text file/)).toBeTruthy()
    }
  )

  it(
    'loads a dropped empty file as empty content instead of flagging it as binary',
    async () => {
      // looksLikeBinary('') has nothing to sample and must not treat an
      // empty file as suspicious — it should load (as empty), not be
      // rejected with the binary-file error message. Starting from
      // non-empty content makes the editor actually clearing itself a
      // meaningful signal that the (async) read completed and ran
      // loadText(''), rather than just asserting the error is absent —
      // which would also be trivially true before the read even finishes.
      render(<App />)
      typeInput('a.com, 1, DIRECT')
      const dropZone = screen.getByLabelText('app-ads.txt input')
      const empty = new File([], 'app-ads.txt', { type: 'text/plain' })

      fireEvent.drop(dropZone, { dataTransfer: { files: [empty] } })

      await waitFor(() => expect(screen.getByLabelText('app-ads.txt input').value).toBe(''))
      expect(screen.queryByText(/doesn't look like a text file/)).toBeFalsy()
    }
  )

  it(
    'warns instead of silently discarding the rest when multiple files are dropped at once',
    async () => {
      // handleDrop only ever read dataTransfer.files[0] — dropping several
      // files (easy to do by accident, unlike the file-picker input, which
      // has no `multiple` attribute and so only ever offers one) silently
      // loaded just the first and discarded the rest with no indication
      // anything was skipped.
      render(<App />)
      const dropZone = screen.getByLabelText('app-ads.txt input')
      const first = new File(['first.com, pub-1, DIRECT'], 'first.txt', { type: 'text/plain' })
      const second = new File(['second.com, pub-2, DIRECT'], 'second.txt', { type: 'text/plain' })

      fireEvent.drop(dropZone, { dataTransfer: { files: [first, second] } })

      expect(await screen.findByText(/Dropped 2 files.*only "first\.txt" was used/))
        .toBeTruthy()
      await waitFor(() => expect(dropZone.value).toBe('first.com, pub-1, DIRECT'))
    }
  )

  it(
    'still mentions the dropped-multiple-files notice when the first file is also oversized',
    async () => {
      // The size-limit check returns before the multi-file notice is ever
      // set, so dropping 2 files where the first one also happens to be
      // oversized used to show only the size error, silently losing the
      // "other files were ignored" information.
      render(<App />)
      const dropZone = screen.getByLabelText('app-ads.txt input')
      const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.txt', { type: 'text/plain' })
      const second = new File(['second.com, pub-2, DIRECT'], 'second.txt', { type: 'text/plain' })

      fireEvent.drop(dropZone, { dataTransfer: { files: [big, second] } })

      const msg = await screen.findByText(/"huge\.txt" is 5\.0 MB/)
      expect(msg.textContent).toMatch(/Dropped 2 files.*only "huge\.txt" was used/)
    }
  )

  it(
    'still mentions the dropped-multiple-files notice when the first file is also binary',
    async () => {
      // Same gap as the size check above, but for the binary-content check.
      render(<App />)
      const dropZone = screen.getByLabelText('app-ads.txt input')
      const bytes = new Uint8Array(200)
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
      const binary = new File([bytes], 'image.png', { type: 'image/png' })
      const second = new File(['second.com, pub-2, DIRECT'], 'second.txt', { type: 'text/plain' })

      fireEvent.drop(dropZone, { dataTransfer: { files: [binary, second] } })

      const msg = await screen.findByText(/"image\.png" doesn't look like a text file/)
      expect(msg.textContent).toMatch(/Dropped 2 files.*only "image\.png" was used/)
    }
  )

  it(
    'clears the stale file-read error when a URL load replaces the input, not just via Clear',
    async () => {
      // Same gap as the "typing over it by hand" case just above, but for
      // every OTHER way the whole input gets replaced through loadText()
      // (Load URL here; Restore version and batch "Load" share the exact
      // same code path) — none of them went through loadFile()/Clear, the
      // only two spots that used to reset fileError.
      const originalReadAsText = FileReader.prototype.readAsText
      FileReader.prototype.readAsText = function () { this.onerror?.() }
      try {
        render(<App />)
        const file = new File(['irrelevant'], 'broken.txt', { type: 'text/plain' })
        const fileInput = document.querySelector('input[type="file"][accept=".txt,text/plain"]')
        fireEvent.change(fileInput, { target: { files: [file] } })
        await screen.findByText(/Failed to read broken\.txt/)
      } finally {
        FileReader.prototype.readAsText = originalReadAsText
      }

      // No manual mockReset() needed here — the global afterEach above resets
      // fetchFromUrl between every test (see its comment for why that was
      // necessary: vi.restoreAllMocks() alone doesn't touch a plain vi.fn()).
      urlModule.fetchFromUrl.mockResolvedValue('google.com, pub-1, DIRECT')
      fireEvent.change(screen.getByPlaceholderText(/example\.com/), { target: { value: 'example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load' }))

      await waitFor(() => expect(screen.queryByText(/Failed to read broken\.txt/)).toBeNull())
    }
  )
})

describe('App — share links', () => {
  afterEach(() => {
    window.history.replaceState(null, '', window.location.pathname)
  })

  it(
    'shows an error and clears the hash instead of doing nothing when a share link fails to decode',
    () => {
      // Before this fix, a corrupted/truncated share hash (a copy-paste
      // mishap, a chat client that wraps or trims long URLs) left nothing
      // happening at all on mount: no content loaded, no indication the
      // link was broken, and the dead hash stayed in the address bar.
      window.location.hash = '#not-valid-base64-!!!'

      render(<App />)

      expect(screen.getByText(/Could not open this share link/)).toBeTruthy()
      expect(window.location.hash).toBe('')
    }
  )

  it('loads the shared content and clears the hash when decoding succeeds', async () => {
    const { encodeShare } = await import('../share.js')
    window.location.hash = `#${encodeShare('a.com, pub-1, DIRECT')}`

    render(<App />)

    expect(screen.getByLabelText('app-ads.txt input').value).toBe('a.com, pub-1, DIRECT')
    expect(window.location.hash).toBe('')
  })

  it(
    'regression: the broken-share-link banner must not outlive it once new content replaces it',
    () => {
      // Before this fix, shareError (set once on mount when the hash fails
      // to decode) had no clearing path anywhere in the file — typing over
      // it, loading a URL/file/version/batch result, even clicking Clear all
      // left "Could not open this share link" sitting at the top of the
      // page for the rest of the session, long after it stopped describing
      // anything still on screen.
      window.location.hash = '#not-valid-base64-!!!'
      render(<App />)
      expect(screen.getByText(/Could not open this share link/)).toBeTruthy()

      typeInput('a.com, pub-1, DIRECT')

      expect(screen.queryByText(/Could not open this share link/)).toBeNull()
    }
  )
})

describe('App — error messages are announced to screen readers', () => {
  afterEach(() => {
    window.history.replaceState(null, '', window.location.pathname)
  })

  it('gives the share-link error an alert role instead of a silent visual-only message', () => {
    // Sighted users see the red text appear; without role="alert" a screen
    // reader gives no indication anything happened unless it happens to be
    // focused on this exact paragraph already — the same "operation fails
    // without telling the user" bug class already fixed for the sighted
    // case here, just for assistive tech instead.
    window.location.hash = '#not-valid-base64-!!!'
    render(<App />)
    expect(screen.getByRole('alert').textContent).toMatch(/Could not open this share link/)
  })

  it('gives the URL-load error an alert role', async () => {
    urlModule.fetchFromUrl.mockRejectedValue(new Error('network error'))
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Failed to load/))
  })

  it('gives the file-read error an alert role', async () => {
    const originalReadAsText = FileReader.prototype.readAsText
    FileReader.prototype.readAsText = function () { this.onerror?.() }
    try {
      render(<App />)
      const file = new File(['irrelevant'], 'broken.txt', { type: 'text/plain' })
      const fileInput = document.querySelector('input[type="file"][accept=".txt,text/plain"]')
      fireEvent.change(fileInput, { target: { files: [file] } })
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Failed to read broken\.txt/))
    } finally {
      FileReader.prototype.readAsText = originalReadAsText
    }
  })
})

describe('App — version history', () => {
  it(
    'does not lose a version saved while a history import is still reading the file — ' +
      "handleImportVersions's FileReader.onload used to merge the imported file into the `versions` " +
      'closed over at click time, so a save that completed during the (async) file read was silently ' +
      'overwritten once the import finished, the same stale-closure race already guarded against ' +
      'elsewhere in this file (handleBatchCheck, handleApplyFix)',
    async () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')

      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      const imported = [{ id: 'imported-1', label: 'Imported', timestamp: 1000, content: 'b.com, 2, DIRECT', stats: null }]
      const file = new File([JSON.stringify(imported)], 'app-ads-versions.json', { type: 'application/json' })

      // Start the import — FileReader.readAsText() is asynchronous, so its onload
      // hasn't fired yet when this returns.
      fireEvent.change(jsonInput, { target: { files: [file] } })

      // While that read is still in flight, save a version synchronously.
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      // Let the FileReader's onload callback run. jsdom's FileReader resolves
      // through its own chain of nested macrotasks, whose exact depth isn't
      // guaranteed across Node/jsdom versions — a single `setTimeout(0)` tick
      // was enough locally but flaked in CI (a different Node major), so
      // poll instead of assuming one tick suffices.
      await waitFor(() => expect(screen.getByText('Imported')).toBeTruthy())
      expect(screen.getByText('Version 1')).toBeTruthy()
    }
  )

  it(
    'shows a failure flash instead of "Saved!" when localStorage.setItem throws (quota exceeded, private mode)',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')

      vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))

      // The version still shows up in memory for this session...
      expect(screen.getByText('Version 1')).toBeTruthy()
      // ...but the button must not claim the save succeeded when persistVersions()
      // actually failed — that would look identical to a real save until the
      // version silently vanishes on the next reload.
      expect(screen.queryByText('✓ Saved!')).toBeFalsy()
      expect(screen.getByRole('button', { name: /Save failed/ })).toBeTruthy()
    }
  )

  it(
    'regression: the Save/Import buttons must announce their result flash to screen readers ' +
      '— every other transient status in this app (Share, Copy output, Copy network template, ' +
      'Copy URL) already has aria-live="polite" on the button whose own text flips to "✓ ..."/' +
      '"⚠ ...", but these two were missed, so a screen reader user got no announcement at all ' +
      'of whether "Save current as version"/"Import history" actually worked',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      expect(screen.getByRole('button', { name: /Save current as version/ }).getAttribute('aria-live')).toBe('polite')
      expect(screen.getByRole('button', { name: /Import history/ }).getAttribute('aria-live')).toBe('polite')
    }
  )

  it(
    'regression: restoring a saved version clears the stale "Loaded from: <url>" breadcrumb, ' +
      'not just the content — loadText() (the shared path for Restore version and batch "Load") ' +
      'already clears fileError on every path that replaces the editor content, but loadedUrl was ' +
      'only ever cleared by typing by hand or clicking Clear, so loading a URL and then restoring a ' +
      'saved version left the breadcrumb pointing at the old URL even though the content on screen ' +
      'no longer came from it',
    async () => {
      urlModule.fetchFromUrl.mockResolvedValueOnce('google.com, pub-1, DIRECT')
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      fireEvent.change(screen.getByPlaceholderText(/example\.com/), { target: { value: 'example.com' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load' }))
      await screen.findByText(/Loaded from:/)

      fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

      expect(screen.queryByText(/Loaded from:/)).toBeNull()
    }
  )

  it(
    'asks for confirmation before deleting a saved version, and keeps it when the user declines',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Version 1')).toBeTruthy()

      confirmSpy.mockReturnValue(true)
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      expect(screen.queryByText('Version 1')).toBeFalsy()
    }
  )

  it(
    'regression: the rename button must announce it renames, not just echo the version label ' +
      '— its visible text IS the version label (e.g. "Version 1"), with "Click to rename" only in ' +
      'a title attribute (a mouse-hover tooltip, not reliably read by screen readers — the same gap ' +
      'already fixed once in this file for the health-score badge), so without an explicit aria-label ' +
      'its accessible name was indistinguishable from plain, non-interactive label text',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))

      expect(screen.queryByRole('button', { name: 'Version 1' })).toBeFalsy()
      expect(screen.getByRole('button', { name: 'Rename "Version 1"' })).toBeTruthy()
    }
  )

  it(
    'disables "Save current as version" once nothing has changed since the last save, instead ' +
      "of leaving it clickable to create an identical duplicate — the button's own `disabled` " +
      "prop mirrors handleSaveVersion's internal early-return guard exactly, which makes that " +
      'internal guard itself unreachable through the real UI (same defense-in-depth class as ' +
      'other already-documented unreachable fallbacks in this file), so this is the one that matters',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      const saveBtn = screen.getByRole('button', { name: /Save current as version/ })
      expect(saveBtn.disabled).toBe(false)

      fireEvent.click(saveBtn)
      expect(screen.getByText('Version 1')).toBeTruthy()
      expect(saveBtn.disabled).toBe(true)
    }
  )

  it('leaves the version unchanged when the rename prompt is cancelled', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
    typeInput('a.com, 1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))

    vi.spyOn(window, 'prompt').mockReturnValue(null)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Rename "Version 1"' }))

    expect(screen.getByText('Version 1')).toBeTruthy()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it(
    'regression: a version that gets truncated out of history by an import (MAX_VERSIONS=30, ' +
      "oldest-first) closes its own open comparison instead of leaving it pointed at a version " +
      "that no longer exists — unlike Delete, which explicitly clears compareId itself when it " +
      "removes the compared version by id, nothing in handleImportVersions does, so this relies " +
      "entirely on the 'keep the open comparison live' effect's own `if (!v) {...}` guard, which " +
      'had never actually been exercised',
    async () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      typeInput('a.com, 1, DIRECT\nb.com, 2, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: 'Compare to current' }))
      expect(screen.getByText('+1 added')).toBeTruthy()

      // 30 freshly-timestamped, distinct versions push the one just saved
      // (and currently compared) out of the MAX_VERSIONS=30 window entirely.
      const flood = Array.from({ length: 30 }, (_, i) => ({
        id: `flood-${i}`, label: `Flood ${i}`, timestamp: Date.now() + 1000 + i, content: `c${i}.com, 1, DIRECT`, stats: null,
      }))
      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      const file = new File([JSON.stringify(flood)], 'flood.json', { type: 'application/json' })
      fireEvent.change(jsonInput, { target: { files: [file] } })
      await waitFor(() => expect(screen.queryByText('Version 1')).toBeFalsy())

      // The compared row itself is gone from the list either way (it no
      // longer exists in `versions`) — the actual regression this guards is
      // versionDiff staying set to its last (now stale) value and the diff
      // panel below the list rendering on regardless, not tied to any
      // specific row's own presence.
      expect(document.querySelector('.version-diff')).toBeFalsy()
    }
  )

  it(
    'alerts when renaming a version fails to persist, instead of pretending it stuck',
    () => {
      // Same "success state shown without checking the operation's result"
      // bug class already guarded against for handleSaveVersion — renaming
      // updates the in-memory list unconditionally, so without this check a
      // failed write looked identical to a real one until the next reload
      // silently reverted the label.
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      vi.spyOn(window, 'prompt').mockReturnValue('Renamed')
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      fireEvent.click(screen.getByRole('button', { name: 'Rename "Version 1"' }))

      expect(screen.getByText('Renamed')).toBeTruthy()
      expect(alertSpy).toHaveBeenCalledTimes(1)
    }
  )

  it(
    'shows a summary pill for a variable-only change, not just the unchanged count — ' +
      'VersionDiffView\'s summary line only had pills for added/removed/cert-changed RECORDS, ' +
      'so a version differing only by a variable (e.g. OWNERDOMAIN) still triggered the expanded ' +
      'diff view (its variable change is listed below the fold) but the summary line itself showed ' +
      'nothing but "N unchanged", with no indication anything had changed at a glance',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('OWNERDOMAIN=a.com\nx.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      typeInput('OWNERDOMAIN=b.com\nx.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: 'Compare to current' }))

      expect(screen.queryByText(/No differences/)).toBeFalsy()
      expect(screen.getByText('1 vars changed')).toBeTruthy()
    }
  )

  it(
    'regression: two added (or removed) values for the same multi-value variable must not ' +
      'share a React key — compareSnapshots pushes one {name, value} entry per changed value ' +
      'for CONTACT/SUBDOMAIN/INVENTORYPARTNERDOMAIN (they may legitimately repeat across lines), ' +
      'but VersionDiffView keyed each list item by `name` alone, which repeats across entries ' +
      'whenever more than one value changes for the same variable in a single diff',
    () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('OWNERDOMAIN=a.com\nx.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))

      typeInput(
        'OWNERDOMAIN=a.com\nx.com, 1, DIRECT\nSUBDOMAIN=one.example.com\nSUBDOMAIN=two.example.com'
      )
      fireEvent.click(screen.getByRole('button', { name: 'Compare to current' }))

      expect(screen.getByText('+ SUBDOMAIN=one.example.com')).toBeTruthy()
      expect(screen.getByText('+ SUBDOMAIN=two.example.com')).toBeTruthy()
      expect(
        errorSpy.mock.calls.some(args => String(args[0]).includes('same key'))
      ).toBe(false)
    }
  )

  it(
    'renders added/removed/cert-changed RECORD lines in the diff, not just variable changes — ' +
      'every other VersionDiffView test so far only exercised the variable-diff (added/changed) path, ' +
      'never a removed variable either',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('CONTACT=old@example.com\na.com, 1, DIRECT, f08c47fec0942fa0\nb.com, 2, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      typeInput('a.com, 1, DIRECT, 44444444444444444\nc.com, 3, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: 'Compare to current' }))

      expect(screen.getByText('+1 added')).toBeTruthy()
      expect(screen.getByText('−1 removed')).toBeTruthy()
      expect(screen.getByText('1 cert changed')).toBeTruthy()
      expect(screen.getByText('+ c.com, 3, DIRECT')).toBeTruthy()
      expect(screen.getByText('− b.com, 2, DIRECT')).toBeTruthy()
      expect(screen.getByText(/f08c47fec0942fa0 → 44444444444444444/)).toBeTruthy()
      expect(screen.getByText('− CONTACT=old@example.com')).toBeTruthy()
    }
  )

  it(
    'renders "(none)" for a cert-changed row\'s side that has NO cert ID — every existing ' +
      'cert-changed test so far compared two non-empty cert IDs, so the `before.certId || ' +
      "'(none)'`/`after.certId || '(none)'` fallback was never actually rendered",
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT, f08c47fec0942fa0')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: 'Compare to current' }))

      expect(screen.getByText('1 cert changed')).toBeTruthy()
      expect(screen.getByText(/f08c47fec0942fa0 → \(none\)/)).toBeTruthy()
    }
  )

  it(
    'shows a saved version\'s own error/warning counts in its row, not just the live output panel — ' +
      'every other version-history test so far saved error-free input, so version-stats\' ' +
      '`{s.errors > 0 && ...}`/`{s.warnings > 0 && ...}` branches were never actually rendered',
    () => {
      const { container } = render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput(
        'a.com, 1, DIRECT, nothex-not-16chars\nb.com, 2, DIRECT, 1234567890123456'
      )
      fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))

      expect(screen.getByText('Version 1')).toBeTruthy()
      // The "N errors"/"N warnings" text is split across its own sibling text
      // nodes ({s.errors} and the literal " errors"), which getByText's
      // default text-node matching can't see as one string — assert on the
      // element's full textContent instead.
      const stats = container.querySelector('.version-stats')
      expect(stats.textContent).toMatch(/1 errors/)
      expect(stats.textContent).toMatch(/2 warnings/)
    }
  )

  it(
    'marks the Compare button as pressed for assistive tech while a comparison is open, not just via its changed label',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('x.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))

      const compareBtn = screen.getByRole('button', { name: 'Compare to current' })
      expect(compareBtn.getAttribute('aria-pressed')).toBe('false')

      fireEvent.click(compareBtn)
      const comparingBtn = screen.getByRole('button', { name: /Comparing/ })
      expect(comparingBtn.getAttribute('aria-pressed')).toBe('true')

      fireEvent.click(comparingBtn)
      expect(screen.getByRole('button', { name: 'Compare to current' }).getAttribute('aria-pressed')).toBe('false')
    }
  )

  it(
    'alerts when importing a history file fails to persist, instead of pretending it stuck',
    async () => {
      // Same unchecked-persistVersions() gap as handleRenameVersion/
      // handleDeleteVersion above, but on the fourth sibling call site —
      // the imported versions landed in React state (so they render) even
      // though the write that was supposed to make them stick failed, with
      // no indication the import wouldn't survive a reload.
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      const imported = [{ id: 'imported-1', label: 'Imported', timestamp: 1000, content: 'b.com, 2, DIRECT', stats: null }]
      const file = new File([JSON.stringify(imported)], 'app-ads-versions.json', { type: 'application/json' })
      fireEvent.change(jsonInput, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText('Imported')).toBeTruthy())
      expect(alertSpy).toHaveBeenCalledTimes(1)
    }
  )

  it(
    'alerts when deleting a version fails to persist, instead of pretending it stuck',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      expect(screen.queryByText('Version 1')).toBeFalsy()
      expect(alertSpy).toHaveBeenCalledTimes(1)
    }
  )

  it(
    'offers "Import history" even with zero saved versions — Export was correctly gated on ' +
      'versions.length > 0 (nothing to export yet), but Import shared that same gate even ' +
      'though its whole purpose is to ADD versions from a file, which made it impossible to ' +
      'bootstrap history on a browser/profile that had none yet',
    async () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      expect(screen.queryByText('Export history')).toBeFalsy()
      expect(screen.getByRole('button', { name: /Import history/ })).toBeTruthy()

      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      const imported = [{ id: 'imported-1', label: 'Imported', timestamp: 1000, content: 'b.com, 2, DIRECT', stats: null }]
      const file = new File([JSON.stringify(imported)], 'app-ads-versions.json', { type: 'application/json' })
      fireEvent.change(jsonInput, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByText('Imported')).toBeTruthy())
    }
  )

  it(
    'shows a success flash with added/skipped counts after importing history, instead of ' +
      'silence — before the fix, only a failed persist (above) got any feedback at all, so a ' +
      'successful import and one where every entry was a duplicate looked identical',
    async () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      const imported = [{ id: 'imported-1', label: 'Imported', timestamp: 1000, content: 'b.com, 2, DIRECT', stats: null }]
      const file = new File([JSON.stringify(imported)], 'app-ads-versions.json', { type: 'application/json' })
      fireEvent.change(jsonInput, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByRole('button', { name: /Imported 1/ })).toBeTruthy())
    }
  )

  it(
    'flashes a warning on the Import button instead of doing nothing visibly when the ' +
      'chosen file is not a version history at all',
    async () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))

      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      const file = new File(['{"not": "a version list"}'], 'notes.json', { type: 'application/json' })
      fireEvent.change(jsonInput, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByRole('button', { name: /Not a valid history file/ })).toBeTruthy())
    }
  )

  it(
    'does nothing when the history file picker is cancelled (no file chosen) — the onChange still ' +
      'fires with an empty FileList, and handleImportVersions must not blow up or flash a warning ' +
      'for a file that was never actually picked',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))

      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      fireEvent.change(jsonInput, { target: { files: [] } })

      expect(screen.queryByRole('button', { name: /Not a valid history file/ })).toBeFalsy()
      expect(screen.queryByRole('button', { name: /Imported/ })).toBeFalsy()
    }
  )

  it(
    'flashes the same "not a valid history file" warning for a chosen file that is not even ' +
      'parseable JSON — distinct from the "valid JSON but not an array" case above, which takes a ' +
      'different branch (JSON.parse itself throws here, instead of failing the Array.isArray check)',
    async () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))

      const jsonInput = document.querySelector('input[type="file"][accept*="json"]')
      const file = new File(['not json at all {'], 'garbage.json', { type: 'application/json' })
      fireEvent.change(jsonInput, { target: { files: [file] } })

      await waitFor(() => expect(screen.getByRole('button', { name: /Not a valid history file/ })).toBeTruthy())
    }
  )

  it(
    'leaves the version label untouched when the rename prompt is cancelled — jsdom defaults ' +
      'window.prompt to returning null, which must be treated the same as an explicitly empty ' +
      'label (no rename, no persistVersions call)',
    () => {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('Version 1')).toBeTruthy()

      vi.spyOn(window, 'prompt').mockReturnValue(null)
      const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
      fireEvent.click(screen.getByRole('button', { name: 'Rename "Version 1"' }))

      expect(screen.getByText('Version 1')).toBeTruthy()
      expect(setItemSpy).not.toHaveBeenCalled()
    }
  )

  it(
    "shows how long ago a saved version was made, switching from minutes to hours to days to " +
      "an actual date — every other version-history test saves and checks immediately, so only " +
      "ever exercises the 'just now' branch",
    () => {
      vi.useFakeTimers()
      const savedAt = Date.now()
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      typeInput('a.com, 1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))
      expect(screen.getByText('just now')).toBeTruthy()

      // Re-closing/reopening the panel is a state change, forcing a fresh
      // render that recomputes formatVersionTime() against the (fake)
      // "now" — nothing else makes this component re-render on its own as
      // time passes, there's no polling/interval for it.
      const reopen = () => {
        fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
        fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
      }

      act(() => { vi.setSystemTime(savedAt + 90 * 1000) }) // 1.5 min
      reopen()
      expect(screen.getByText('1m ago')).toBeTruthy()

      act(() => { vi.setSystemTime(savedAt + 3 * 60 * 60 * 1000) }) // 3h
      reopen()
      expect(screen.getByText('3h ago')).toBeTruthy()

      act(() => { vi.setSystemTime(savedAt + 2 * 24 * 60 * 60 * 1000) }) // 2 days
      reopen()
      expect(screen.getByText('2d ago')).toBeTruthy()

      const faraway = savedAt + 10 * 24 * 60 * 60 * 1000 // 10 days
      act(() => { vi.setSystemTime(faraway) })
      reopen()
      expect(screen.getByText(new Date(savedAt).toLocaleDateString())).toBeTruthy()
    }
  )
})

describe('App — export/download buttons', () => {
  it('exports saved version history as a downloadable JSON file', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
    typeInput('a.com, 1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Save current as version/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Export history' }))

    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('clicking "Upload file" opens the native file picker', () => {
    render(<App />)
    const fileInput = document.querySelector('input[type="file"][accept*="text/plain"]')
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: 'Upload file' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('clicking "Import history" opens the native file picker, even with zero saved versions', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
    const fileInput = document.querySelector('input[type="file"][accept*="json"]')
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: /Import history/ }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('sorts the Cleaned output textarea A–Z when the Sort A–Z checkbox is checked', () => {
    render(<App />)
    typeInput('b.com, 2, DIRECT\na.com, 1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    expect(screen.getByLabelText('Cleaned output').value.indexOf('b.com'))
      .toBeLessThan(screen.getByLabelText('Cleaned output').value.indexOf('a.com'))

    fireEvent.click(screen.getByRole('checkbox', { name: /Sort A.Z/ }))

    const sorted = screen.getByLabelText('Cleaned output').value
    expect(sorted.indexOf('a.com')).toBeLessThan(sorted.indexOf('b.com'))
  })

  it('exports JSON in the same sorted order as the Sort A–Z .txt output, not raw validator order', () => {
    let capturedContent
    const OrigBlob = globalThis.Blob
    // mockImplementation needs something `new`-able — an arrow function has
    // no [[Construct]] and throws "is not a constructor" the moment
    // downloadFile() does `new Blob(...)`.
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts, opts) {
      capturedContent = parts[0]
      return new OrigBlob(parts, opts)
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<App />)
    typeInput('b.com, 2, DIRECT\na.com, 1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Sort A.Z/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))

    const records = JSON.parse(capturedContent)
    expect(records.map(r => r.domain)).toEqual(['a.com', 'b.com'])
  })
})

describe('App — batch check', () => {
  it(
    'does not leave "Check all URLs" stuck disabled when Clear results is clicked mid-flight',
    async () => {
      let resolveFetch
      urlModule.fetchFromUrl.mockReturnValue(new Promise(resolve => { resolveFetch = resolve }))

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
        target: { value: 'a.com\nb.com' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
      expect(screen.getByRole('button', { name: 'Checking…' })).toBeTruthy()

      // The fetch above is still pending — Clear results is never disabled
      // during a check (unlike Export CSV right next to it), so a user can
      // click it mid-flight.
      fireEvent.click(screen.getByRole('button', { name: 'Clear results' }))

      // Before the fix: bumping batchGenRef here made the in-flight
      // handleBatchCheck's own `if (batchGenRef.current === gen)` guard in
      // its finally block fail, so it never called setBatchLoading(false) —
      // and nothing else ever did either, leaving the button stuck showing
      // "Checking…" (disabled) forever, even with no results and nothing
      // actually running.
      expect(screen.getByRole('button', { name: 'Check all URLs' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Checking…' })).toBeFalsy()

      await act(async () => { resolveFetch('google.com, pub-1, DIRECT') })
    }
  )

  it(
    'regression: clears the stale "Failed to load" URL error when a batch result is loaded ' +
      'instead — loadText() (the shared path for Restore version and batch "Load") already ' +
      'clears fileError/loadedUrl/shareError on every path that replaces the editor content, but ' +
      'urlError was only ever cleared by handleLoadUrl itself, so failing a direct URL load and ' +
      'then loading a batch-checked URL\'s content left the old "Failed to load: ..." message on ' +
      'screen under the new, successfully-loaded content',
    async () => {
      urlModule.fetchFromUrl.mockRejectedValueOnce(new Error('network error'))
      render(<App />)
      fireEvent.change(screen.getByPlaceholderText(/example\.com/), { target: { value: 'bad.example' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load' }))
      await screen.findByText(/Failed to load/)

      urlModule.fetchFromUrl.mockResolvedValueOnce('google.com, pub-1, DIRECT')
      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
        target: { value: 'a.com' },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
      })

      fireEvent.click(document.querySelector('.batch-load-btn'))

      expect(screen.queryByText(/Failed to load/)).toBeNull()
    }
  )

  it(
    'regression: clears the stale "Failed to load" URL error when the user follows its own ' +
      'advice and types/pastes content directly into the main editor — handleInputChange already ' +
      'clears fileError/loadedUrl/shareError on every keystroke (so manual edits don\'t leave those ' +
      'stale), but never cleared urlError, whose own message ends with "Try pasting the content ' +
      'directly" — doing exactly that still left "Failed to load: ..." on screen above the new, ' +
      'valid content',
    async () => {
      urlModule.fetchFromUrl.mockRejectedValueOnce(new Error('network error'))
      render(<App />)
      fireEvent.change(screen.getByPlaceholderText(/example\.com/), { target: { value: 'bad.example' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load' }))
      await screen.findByText(/Failed to load/)

      typeInput('a.com, pub-1, DIRECT')

      expect(screen.queryByText(/Failed to load/)).toBeNull()
    }
  )

  it(
    'regression: the "Clear" button must also drop the stale "Failed to load" URL error, same ' +
      'gap as handleInputChange just above',
    async () => {
      urlModule.fetchFromUrl.mockRejectedValueOnce(new Error('network error'))
      render(<App />)
      fireEvent.change(screen.getByPlaceholderText(/example\.com/), { target: { value: 'bad.example' } })
      fireEvent.click(screen.getByRole('button', { name: 'Load' }))
      await screen.findByText(/Failed to load/)

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

      expect(screen.queryByText(/Failed to load/)).toBeNull()
    }
  )

  it(
    'regression: a batch row\'s "Copy URL" button must announce "Copied!", not swap to a bare ' +
      "checkmark with no word at all — every other copy-confirmation button in this file " +
      '(Share, the main Copy button, the network-coverage template button, Save/Import) flips ' +
      'its own visible text to something containing "Copied"/"Imported"/etc. so aria-live has a ' +
      'word to announce, but this one only ever showed the bare "✓" glyph on success',
    async () => {
      document.execCommand = vi.fn(() => true)
      urlModule.fetchFromUrl.mockResolvedValue('google.com, pub-1, DIRECT')

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
        target: { value: 'a.com' },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
      })

      const copyUrlBtn = screen.getByRole('button', { name: 'Copy URL' })
      await act(async () => { fireEvent.click(copyUrlBtn) })

      expect(copyUrlBtn.textContent).toContain('Copied')
      expect(copyUrlBtn.textContent).not.toBe('✓')
    }
  )

  it(
    "each batch row's Load button loads THAT row's own content, not a stale/wrong one — " +
      'guards the memo()/useCallback refactor from the 75th-cycle performance fix: a row keeps ' +
      'its own item identity across re-renders (only the completing row gets a new object in ' +
      'setBatchResults), and handleBatchRowLoad receives that row\'s item as an argument rather ' +
      "than closing over it, so clicking row 2's Load after row 1 still loads row 2's content",
    async () => {
      urlModule.fetchFromUrl.mockImplementation((url) =>
        Promise.resolve(url.includes('a.com') ? 'a.com, 1, DIRECT' : 'b.com, 2, DIRECT'))

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
        target: { value: 'a.com\nb.com' },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
      })

      const batchResultsEl = document.querySelector('.batch-results')
      const loadButtons = within(batchResultsEl).getAllByRole('button', { name: 'Load' })
      expect(loadButtons).toHaveLength(2)

      fireEvent.click(loadButtons[1])
      expect(screen.getByLabelText('app-ads.txt input').value).toBe('b.com, 2, DIRECT')

      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.click(within(document.querySelector('.batch-results')).getAllByRole('button', { name: 'Load' })[0])
      expect(screen.getByLabelText('app-ads.txt input').value).toBe('a.com, 1, DIRECT')
    }
  )

  it(
    'renders a dedicated error row (icon, message, and its own Copy URL button) for a URL that ' +
      "fails during the batch check — every other batch test only exercises the success path, so " +
      "the row's whole status === 'error' render branch (with its own, separate Copy URL button) " +
      'was never actually reached',
    async () => {
      urlModule.fetchFromUrl.mockImplementation((url) =>
        url.includes('bad') ? Promise.reject(new Error('network error')) : Promise.resolve('a.com, 1, DIRECT'))

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
        target: { value: 'good.com\nbad.com' },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
      })

      const batchResultsEl = document.querySelector('.batch-results')
      expect(within(batchResultsEl).getByText('network error')).toBeTruthy()
      expect(document.querySelector('.batch-row-error')).toBeTruthy()
      expect(within(document.querySelector('.batch-row-error')).getByRole('button', { name: 'Copy URL' })).toBeTruthy()
    }
  )

  it(
    'renders a warning row (not an error or ok row) for a URL whose content only has warnings ' +
      '— every other batch test exercises either the error branch or the implicit ok branch, never ' +
      "the row's hasWarnings-but-not-hasErrors state in between",
    async () => {
      urlModule.fetchFromUrl.mockResolvedValue('a.com, 1, DIRECT, , extra')

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
        target: { value: 'warn.com' },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
      })

      expect(document.querySelector('.batch-row-warning')).toBeTruthy()
      expect(document.querySelector('.batch-row-error')).toBeFalsy()
      expect(document.querySelector('.batch-stat-warning')).toBeTruthy()
    }
  )

  it(
    'shows a "dupes" count in a batch row when its fetched content has a duplicate record — no ' +
      "existing batch test's content ever had a duplicate, so stats.duplicatesRemoved > 0's span " +
      'was never actually rendered',
    async () => {
      urlModule.fetchFromUrl.mockResolvedValue('a.com, 1, DIRECT\na.com, 1, DIRECT')

      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
      fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
        target: { value: 'dupes.com' },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
      })

      const batchResultsEl = document.querySelector('.batch-results')
      expect(within(batchResultsEl).getByText(/1 dupes/)).toBeTruthy()
    }
  )

  it('exports batch results as a downloadable CSV', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    urlModule.fetchFromUrl.mockResolvedValue('google.com, pub-1, DIRECT')

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
    fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
      target: { value: 'a.com' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})

describe('App — transient flash messages clear after their own full duration', () => {
  // Every regression test above for these same timers (Share, Copy, batch Copy
  // URL) deliberately fires a SECOND click before the first click's timer is
  // due, to prove the stale one gets cleared and never fires at all — none of
  // them ever let an un-superseded timer actually run to completion, so
  // nothing confirmed the ordinary, non-raced case: a single click's flash
  // really does clear back to the idle label once its own 2s/4s is up.

  it('clears the main Copy button\'s "Copied!" flash back to "Copy" after 2s', async () => {
    vi.useFakeTimers()
    document.execCommand = vi.fn(() => true)
    render(<App />)
    typeInput('google.com, pub-1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    const copyBtn = screen.getByRole('button', { name: 'Copy' })

    await act(async () => { fireEvent.click(copyBtn) })
    expect(copyBtn.textContent).toContain('Copied')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(copyBtn.textContent).toBe('Copy')
  })

  it('clears the Share button\'s "Copied!" flash back to "Share" after its 2s', async () => {
    vi.useFakeTimers()
    document.execCommand = vi.fn(() => true)
    render(<App />)
    typeInput('google.com, pub-1, DIRECT')
    const shareBtn = screen.getByRole('button', { name: 'Share' })

    await act(async () => { fireEvent.click(shareBtn) })
    expect(shareBtn.textContent).toContain('Copied')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(shareBtn.textContent).toBe('Share')
  })

  it('clears the Share button\'s "Copy failed" flash back to "Share" after its own 4s (longer than the 2s success case)', async () => {
    vi.useFakeTimers()
    document.execCommand = vi.fn(() => false)
    render(<App />)
    typeInput('google.com, pub-1, DIRECT')
    const shareBtn = screen.getByRole('button', { name: 'Share' })

    await act(async () => { fireEvent.click(shareBtn) })
    expect(shareBtn.textContent).toContain('Copy failed')

    act(() => { vi.advanceTimersByTime(4000) })
    expect(shareBtn.textContent).toBe('Share')
  })

  it('clears a network-coverage template button\'s "copied!" flash back to its domain after 2s', async () => {
    vi.useFakeTimers()
    document.execCommand = vi.fn(() => true)
    render(<App />)
    typeInput('google.com, pub-1, DIRECT')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    fireEvent.click(screen.getByRole('button', { name: /Network Coverage/ }))
    const templateBtn = screen.getByTitle(/AppNexus/)

    await act(async () => { fireEvent.click(templateBtn) })
    expect(templateBtn.textContent).toContain('copied!')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(templateBtn.textContent).not.toContain('copied!')
  })

  it('clears the "✓ Saved!" flash back to "Save current as version" after its 2s', () => {
    vi.useFakeTimers()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
    typeInput('a.com, 1, DIRECT')
    const saveBtn = screen.getByRole('button', { name: /Save current as version/ })

    fireEvent.click(saveBtn)
    expect(saveBtn.textContent).toContain('Saved')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(saveBtn.textContent).toContain('Save current as version')
  })

  it('clears a batch row\'s "Copied!" flash back to "Copy URL" after its own 2s', async () => {
    vi.useFakeTimers()
    document.execCommand = vi.fn(() => true)
    urlModule.fetchFromUrl.mockResolvedValue('google.com, pub-1, DIRECT')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
    fireEvent.change(screen.getByLabelText('URLs to check, one per line'), {
      target: { value: 'a.com' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check all URLs' }))
    })

    const copyUrlBtn = screen.getByRole('button', { name: 'Copy URL' })
    await act(async () => { fireEvent.click(copyUrlBtn) })
    expect(copyUrlBtn.textContent).toContain('Copied')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(copyUrlBtn.textContent).toBe('Copy URL')
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

  it('highlights the editor while a file is dragged over it, and un-highlights on drag leave', () => {
    render(<App />)
    const editor = screen.getByLabelText('app-ads.txt input')
    expect(editor.className).not.toContain('editor-drag')

    fireEvent.dragOver(editor)
    expect(editor.className).toContain('editor-drag')

    fireEvent.dragLeave(editor)
    expect(editor.className).not.toContain('editor-drag')
  })

  it('validates on Ctrl+Enter from inside the editor, same as clicking Validate', () => {
    render(<App />)
    typeInput('bar.com, pub-1, direct')
    fireEvent.keyDown(screen.getByLabelText('app-ads.txt input'), { key: 'Enter', ctrlKey: true })
    expect(screen.getByLabelText('Cleaned output').value).toBe('bar.com, pub-1, DIRECT')
  })
})

// Stands in for eslint-plugin-jsx-a11y's "every button needs an accessible
// name" check — that plugin's latest release (6.10.2) only supports
// eslint up to v9, and this repo is on eslint 10, so installing it fails
// with an unresolvable peer-dependency conflict. jest-dom (which has a
// toHaveAccessibleName matcher) isn't set up in this project either, so
// this computes the name the same way Testing Library's own getByRole
// does under the hood, via the dom-accessibility-api package it already
// depends on transitively.
describe('App — every button has an accessible name', () => {
  const expectAllButtonsToHaveAccessibleNames = () => {
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(computeAccessibleName(button)).not.toBe('')
    }
  }

  it('in the empty initial state', () => {
    render(<App />)
    expectAllButtonsToHaveAccessibleNames()
  })

  it('after validating a file (result, diff and coverage sections rendered)', () => {
    render(<App />)
    typeInput('OWNERDOMAIN=example.com\nfoo.com, 1\nbar.com, pub-1, direct')
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    expectAllButtonsToHaveAccessibleNames()
  })

  it('with the batch URL check panel open', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Batch URL check/ }))
    expectAllButtonsToHaveAccessibleNames()
  })

  it('with the version history panel open', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Version history/ }))
    expectAllButtonsToHaveAccessibleNames()
  })
})
