// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
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
  })

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
      fireEvent.click(screen.getByRole('button', { name: 'Version 1' }))

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
