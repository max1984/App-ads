import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle, memo } from 'react'
import { validateAdsTxt, TOP_NETWORKS, DOMAIN_TO_CERT, compareSnapshots, formatRecordLine, computeHealthScore } from './validator'
import { normalizeAdsTxtUrl, fetchFromUrl } from './url'
import { sortCleanedOutput, sortRecordsForExport } from './output'
import { batchResultsToCsv, summarizeBatch } from './batch'
import { decodeShare, buildShareUrl, copyText } from './share'
import { loadVersions, persistVersions, mergeImportedVersions, MAX_VERSIONS } from './versions'
import './App.css'

const PLACEHOLDER = `# Paste your app-ads.txt content here
# or drag & drop / upload a .txt file

google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
appnexus.com, 1234, RESELLER, f5ab79cb980f11d1`

const LARGE_FILE_THRESHOLD = 2000
const DARK_MODE_KEY = 'app-ads-dark-mode'

// Manual dark-mode toggle used to be forgotten on every reload, silently
// reverting to the OS preference — localStorage read/write is best-effort
// since it can throw (private mode/disabled storage), in which case we just
// fall back to the OS preference like before.
function loadStoredDarkMode() {
  try {
    const raw = globalThis.localStorage?.getItem(DARK_MODE_KEY)
    return raw === '1' ? true : raw === '0' ? false : null
  } catch { return null }
}

function persistDarkMode(value) {
  try { globalThis.localStorage?.setItem(DARK_MODE_KEY, value ? '1' : '0') } catch { /* best effort */ }
}

function formatVersionTime(ts) {
  const diffMs = Date.now() - ts
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  // a.click() only *triggers* the download — some browsers (notably older
  // Firefox/Safari) read the blob asynchronously, so revoking the object
  // URL on the very next line can race the read and silently abort the
  // download. Deferring to a macrotask lets the browser actually start
  // reading first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// BUG-05 FIX: semaphore to cap batch concurrency at 5
function createSemaphore(max) {
  let count = 0
  const queue = []
  return async function run(fn) {
    if (count >= max) await new Promise(resolve => queue.push(resolve))
    count++
    try { return await fn() }
    finally { count--; if (queue.length) queue.shift()() }
  }
}

export default function App() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedOutput, setCopiedOutput] = useState(false)
  const [shareStatus, setShareStatus] = useState(null)  // null | 'copied' | 'too-large' | 'failed'
  const [copiedNetwork, setCopiedNetwork] = useState(null)
  const [issueFilter, setIssueFilter] = useState('all')
  const [urlValue, setUrlValue] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [fileError, setFileError] = useState('')
  const [shareError, setShareError] = useState(false)
  const [loadedUrl, setLoadedUrl] = useState('')
  const [collapsedIssues, setCollapsedIssues] = useState(new Set())
  const [sortOutput, setSortOutput] = useState(false)
  const [showCoverage, setShowCoverage] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchResults, setBatchResults] = useState([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState(() => loadVersions())
  const [compareId, setCompareId] = useState(null)
  const [versionDiff, setVersionDiff] = useState(null)
  const [savedFlash, setSavedFlash] = useState(null)  // null | 'saved' | 'failed'
  // Counter, not a boolean: handleImportVersions sets this from inside a
  // setVersions() updater (see there for why), so the alert itself lives in
  // an effect reacting to the committed value instead of right after that
  // call — a boolean wouldn't re-fire this effect on a second import in a
  // row that fails the exact same way (no apparent *change* in value).
  const [importSaveFailures, setImportSaveFailures] = useState(0)
  // null | 'invalid' | { added, skipped } — nothing previously told the user
  // anything about a *successful* import, or one whose file wasn't a version
  // history at all (JSON.parse/mergeImportedVersions failure is swallowed by
  // handleImportVersions's catch below with a code comment, no UI). Importing
  // a file that was entirely duplicates/invalid looked identical to importing
  // one that genuinely added history: same silence either way. Same
  // "✓ Saved!"-style flash already used for Save, on the Import button.
  const [importFlash, setImportFlash] = useState(null)
  const [darkMode, setDarkMode] = useState(() => {
    const stored = loadStoredDarkMode()
    return stored !== null ? stored : window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  })

  const fileInputRef = useRef()
  const versionFileInputRef = useRef()
  const inputEditorRef = useRef()
  const validateTimerRef = useRef()
  const batchGenRef = useRef(0)  // BUG-06 FIX: generation counter for race condition
  const shareStatusTimerRef = useRef()
  const copiedNetworkTimerRef = useRef()
  const savedFlashTimerRef = useRef()
  const importFlashTimerRef = useRef()
  const copiedOutputTimerRef = useRef()

  useEffect(() => {
    // index.css's dark-mode override is `[data-dark]` — an attribute-PRESENCE
    // selector, matching regardless of the attribute's value. Setting it to
    // '' for light mode still left the attribute present, so dark styling
    // applied unconditionally and the toggle never visually did anything —
    // must remove the attribute entirely for light mode, not just empty it.
    if (darkMode) document.documentElement.setAttribute('data-dark', '1')
    else document.documentElement.removeAttribute('data-dark')
    persistDarkMode(darkMode)
  }, [darkMode])

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const decoded = decodeShare(hash)
    // Clear the hash whether decoding succeeded or not — previously this
    // only happened on success, so a corrupted/truncated share link (a
    // copy-paste mishap, a chat client that wraps or trims long URLs) left
    // nothing happening at all: no content loaded, no indication the link
    // was broken, and the same dead hash still sitting in the address bar
    // for the next reload or re-share to fail on again just the same way.
    history.replaceState(null, '', window.location.pathname)
    if (decoded) {
      // Harmless today (this effect's empty deps array means it only ever
      // runs once, on mount, before any keystroke could have armed
      // handleInputChange's debounce timer) — kept anyway so this doesn't
      // silently become the same stale-debounce race fixed elsewhere in
      // this file if this decode logic is ever moved later in the
      // component's lifecycle (e.g. behind a button instead of on mount).
      clearTimeout(validateTimerRef.current)
      setInput(decoded)
      setResult(validateAdsTxt(decoded))
    } else {
      setShareError(true)
    }
  }, [])

  // BUG-01 FIX: also reset issueFilter when result changes
  useEffect(() => {
    setCollapsedIssues(new Set())
    setIssueFilter('all')
    // UX-05 FIX: auto-expand diff when there are changes
    if (result?.changes.length > 0) setShowDiff(true)
  }, [result])

  // See handleImportVersions below for why this alert lives here instead of
  // right after the setVersions() call that detects the failure.
  useEffect(() => {
    if (importSaveFailures > 0) {
      window.alert('Failed to save the imported history — your browser storage may be full or unavailable. The import will be lost on reload.')
    }
  }, [importSaveFailures])

  const runValidation = useCallback((text) => {
    clearTimeout(validateTimerRef.current)
    if (!text.trim()) { setResult(null); return }
    setResult(validateAdsTxt(text))
  }, [])

  const handleInputChange = useCallback((e) => {
    const text = e.target.value
    setInput(text)
    setLoadedUrl('')  // BUG-03 FIX: clear stale URL breadcrumb on manual edit
    clearTimeout(validateTimerRef.current)
    if (!text.trim()) { setResult(null); return }
    validateTimerRef.current = setTimeout(() => setResult(validateAdsTxt(text)), 300)
  }, [])

  const loadText = useCallback((text) => {
    // Without this, a debounced re-validation from handleInputChange that's
    // still pending (the user typed, then within 300ms loaded a file/URL/
    // version/batch result instead of waiting) fires moments later and
    // overwrites the just-loaded result with a validation of the OLD,
    // already-replaced text.
    clearTimeout(validateTimerRef.current)
    setInput(text)
    setResult(validateAdsTxt(text))
  }, [])

  const loadFile = useCallback((file) => {
    if (!file) return
    setFileError('')
    const reader = new FileReader()
    reader.onload = (e) => loadText(e.target.result)
    // Without this, a failed read (permission error, the file being removed/
    // unmounted between picking it and the read completing, a dropped item
    // that looks like a file but isn't one FileReader can actually read) left
    // onload never firing and nothing else reacting — the drop zone/"Upload
    // file" button would look like it silently did nothing, exactly the
    // "operation fails without telling the user" class already fixed
    // elsewhere for handleLoadUrl's fetch failures (see urlError above).
    reader.onerror = () => setFileError(
      `Failed to read ${file.name}: ${reader.error?.message || 'unknown error'}.`
    )
    reader.readAsText(file, 'utf-8')
  }, [loadText])

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    loadFile(e.dataTransfer.files[0])
  }

  const handleLoadUrl = async () => {
    // The Load button is disabled while urlLoading, but the url-input's Enter
    // handler below isn't gated on it — pressing Enter again before the first
    // fetchFromUrl() resolves started a second, fully concurrent fetch with no
    // generation guard (unlike handleBatchCheck's batchGenRef). Whichever
    // resolves last then wins, silently overwriting the input/result with its
    // content even if it was the earlier, now-stale request.
    if (urlLoading) return
    const url = normalizeAdsTxtUrl(urlValue)
    if (!url) return
    setUrlLoading(true)
    setUrlError('')
    try {
      const text = await fetchFromUrl(url)
      loadText(text)
      setLoadedUrl(url)
      setUrlValue('')
    } catch (e) {
      setUrlError(`Failed to load: ${e.message}. Try pasting the content directly.`)
    } finally {
      setUrlLoading(false)
    }
  }

  // BUG-05 + BUG-06 FIX: semaphore-limited concurrency + generation counter
  const handleBatchCheck = async () => {
    const urls = batchInput.split('\n').map(normalizeAdsTxtUrl).filter(Boolean)
    if (!urls.length) return
    const gen = ++batchGenRef.current
    setBatchLoading(true)
    setBatchResults(urls.map(url => ({ url, status: 'loading', result: null, content: null, error: null })))
    const sem = createSemaphore(5)
    // try/finally so an unexpected rejection (every path inside the per-URL
    // task already catches its own errors, but sem()/Promise.all itself
    // re-throwing on anything else it didn't anticipate is exactly the kind
    // of thing a later change here could introduce) can't leave batchLoading
    // stuck true forever — same fix as handleLoadUrl just above.
    try {
      await Promise.all(
        urls.map((url, i) => sem(async () => {
          if (batchGenRef.current !== gen) return
          try {
            const content = await fetchFromUrl(url)
            const r = validateAdsTxt(content)
            if (batchGenRef.current !== gen) return
            setBatchResults(prev => { const n = [...prev]; n[i] = { url, status: 'done', result: r, content, error: null }; return n })
          } catch (e) {
            if (batchGenRef.current !== gen) return
            setBatchResults(prev => { const n = [...prev]; n[i] = { url, status: 'error', result: null, content: null, error: e.message }; return n })
          }
        }))
      )
    } finally {
      if (batchGenRef.current === gen) setBatchLoading(false)
    }
  }

  // VERSIONING: keep the open comparison live as the input changes
  useEffect(() => {
    if (!compareId) return
    const v = versions.find(x => x.id === compareId)
    if (!v) { setCompareId(null); setVersionDiff(null); return }
    setVersionDiff(compareSnapshots(v.content, input))
  }, [input, compareId, versions])

  const handleSaveVersion = () => {
    if (!input.trim()) return
    if (versions[0]?.content === input) return  // no changes since last save
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      label: `Version ${versions.length + 1}`,
      timestamp: Date.now(),
      content: input,
      stats: result?.stats
        ? { keptRecords: result.stats.keptRecords, errors: result.stats.errors, warnings: result.stats.warnings }
        : null,
    }
    const next = [entry, ...versions].slice(0, MAX_VERSIONS)
    setVersions(next)
    // persistVersions() can fail (storage quota exceeded, private mode) while
    // setVersions() above always succeeds in memory — without checking the
    // return value, the button would flash "✓ Saved!" even though nothing
    // was actually written, the same "success state shown without checking
    // the operation's result" bug class already guarded against for
    // copyText() in handleShare/handleCopyUrl/handleCopyOutput. A failed save
    // here is worse: it looks identical to a real one until the next reload
    // silently drops the version.
    const ok = persistVersions(next)
    clearTimeout(savedFlashTimerRef.current)
    setSavedFlash(ok ? 'saved' : 'failed')
    savedFlashTimerRef.current = setTimeout(() => setSavedFlash(null), ok ? 2000 : 4000)
  }

  const handleRenameVersion = (id) => {
    const v = versions.find(x => x.id === id)
    if (!v) return
    const label = window.prompt('Version name:', v.label)
    if (!label || !label.trim()) return
    const next = versions.map(x => x.id === id ? { ...x, label: label.trim() } : x)
    setVersions(next)
    // persistVersions()'s return value is already checked in handleSaveVersion
    // (storage quota / private mode can make the write fail while the
    // in-memory list always updates) — this sibling call ignored it, so a
    // failed rename looked identical to a real one until the next reload
    // silently reverted the label.
    if (!persistVersions(next)) {
      window.alert('Failed to save the new name — your browser storage may be full or unavailable. The rename will be lost on reload.')
    }
  }

  const handleDeleteVersion = (id) => {
    // Unlike every other version action (Restore/Compare are non-destructive,
    // Rename already asks via window.prompt), this one is a silent, permanent
    // delete with no undo — a single stray click on the small icon-sized
    // "Delete" button in a scrollable list loses saved history for good.
    if (!window.confirm('Delete this version? This cannot be undone.')) return
    const next = versions.filter(v => v.id !== id)
    setVersions(next)
    // Same unchecked-persistVersions() gap as handleRenameVersion above — a
    // failed write here means the "deleted" version reappears on reload,
    // looking like the delete silently undid itself with no explanation.
    if (!persistVersions(next)) {
      window.alert('Failed to save after deleting — your browser storage may be full or unavailable. The deleted version may reappear on reload.')
    }
    if (compareId === id) { setCompareId(null); setVersionDiff(null) }
  }

  const handleRestoreVersion = (v) => {
    loadText(v.content)
    setCompareId(null)
    setVersionDiff(null)
  }

  const handleCompareVersion = (v) => {
    setCompareId(prev => prev === v.id ? null : v.id)
    if (compareId !== v.id) setVersionDiff(compareSnapshots(v.content, input))
    else setVersionDiff(null)
  }

  const handleExportVersions = () => {
    if (!versions.length) return
    downloadFile(JSON.stringify(versions, null, 2), 'app-ads-versions.json', 'application/json')
  }

  const handleImportVersions = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const invalid = () => {
        clearTimeout(importFlashTimerRef.current)
        setImportFlash('invalid')
        importFlashTimerRef.current = setTimeout(() => setImportFlash(null), 4000)
      }
      let imported
      try {
        imported = JSON.parse(e.target.result)
      } catch {
        invalid()
        return
      }
      // mergeImportedVersions() throws on this exact condition — checked
      // again here, before setVersions, instead of relying on that throw:
      // it has to run inside the setVersions functional updater below (see
      // there for why), and React does not run that updater synchronously
      // within this call stack, so a throw from inside it is NOT caught by
      // a try/catch wrapped around the setVersions() call — it surfaced as
      // an uncaught exception instead of the graceful "ignore" the dead
      // catch block here used to claim.
      if (!Array.isArray(imported)) {
        invalid()
        return
      }
      // FileReader is async — reading `versions` here (closed over at the click that
      // started the read) would merge against whatever the list looked like back then,
      // silently discarding a save/rename/delete that completed while the file was being
      // read. Merge against the functional-updater's `prev` instead, so this always sees
      // the current list — same race class as handleBatchCheck's batchGenRef guards against.
      setVersions(prev => {
        const merged = mergeImportedVersions(prev, imported, MAX_VERSIONS)
        // Same unchecked-persistVersions() gap as handleRenameVersion/
        // handleDeleteVersion above — this is the fourth sibling call and
        // was the one actually missed: a failed write here means the
        // imported versions look merged in (they're in `merged`, now in
        // React state) but vanish again on the next reload with no
        // indication the import didn't really stick. The alert can't live
        // right here, synchronously after this call returns — this
        // updater runs whenever React gets around to it (it's queued from
        // FileReader.onload, outside any React event handler), not
        // necessarily before the very next line of this function — so the
        // failure is surfaced through its own state instead, picked up by
        // the effect below once React actually commits it.
        if (!persistVersions(merged.versions)) setImportSaveFailures(n => n + 1)
        // Set from inside this updater, not after setVersions() returns, for
        // the exact same reason as the comment just above: there is no
        // guarantee this updater has even run yet by the next line of this
        // function, so added/skipped read from out there could still be
        // their unset initial values.
        clearTimeout(importFlashTimerRef.current)
        setImportFlash({ added: merged.added, skipped: merged.skipped + merged.droppedForSpace })
        importFlashTimerRef.current = setTimeout(() => setImportFlash(null), 3000)
        return merged.versions
      })
    }
    reader.readAsText(file, 'utf-8')
  }

  const { displayContent, displayStatuses, sortedRecords } = useMemo(() => {
    if (!result) return { displayContent: '', displayStatuses: [], sortedRecords: [] }
    if (!sortOutput) return {
      displayContent: result.cleanedContent,
      displayStatuses: result.outputLineStatuses,
      sortedRecords: result.records,
    }
    const sortedOutput = sortCleanedOutput(result.cleanedContent, result.outputLineStatuses)
    // BUG-04 FIX: also sort records for JSON export, matching sortCleanedOutput's order
    return {
      displayContent: sortedOutput.content,
      displayStatuses: sortedOutput.statuses,
      sortedRecords: sortRecordsForExport(result.records),
    }
  }, [result, sortOutput])

  const handleCopyOutput = async () => {
    if (!result) return
    if (!(await copyText(displayContent))) return
    // Same stale-timer race as shareStatusTimerRef/copiedNetworkTimerRef:
    // clicking Copy again within 2s armed a second, independent timer
    // without clearing the first, so the first still fired at its own
    // t=2000 and hid the "Copied!" flash early instead of the full 2s
    // from the latest click.
    clearTimeout(copiedOutputTimerRef.current)
    setCopiedOutput(true)
    copiedOutputTimerRef.current = setTimeout(() => setCopiedOutput(false), 2000)
  }

  const handleDownload = () => {
    if (!result) return
    downloadFile(displayContent, 'app-ads.txt', 'text/plain')
  }

  const handleBatchCsvExport = () => {
    downloadFile(batchResultsToCsv(batchResults), 'app-ads-batch.csv', 'text/csv')
  }

  const handleJsonExport = () => {
    if (!result) return
    // BUG-04 FIX: use sortedRecords so JSON matches the sorted .txt download
    downloadFile(JSON.stringify(sortedRecords, null, 2), 'app-ads.json', 'application/json')
  }

  const handleShare = async () => {
    const { url, error } = buildShareUrl(input, `${window.location.origin}${window.location.pathname}`)
    if (error === 'empty') return
    const status = error === 'too-large' ? 'too-large' : error ? 'failed' : (await copyText(url)) ? 'copied' : 'failed'
    // Without clearing the previous timer, clicking Share again before it
    // fires leaves TWO pending timers — the stale one (armed for the OLD
    // status's duration) still fires unconditionally and wipes whatever
    // status is current, even a longer-lived one from this newer click
    // (e.g. a 2s "copied" timer erasing a 4s "failed" message 3s early).
    clearTimeout(shareStatusTimerRef.current)
    setShareStatus(status)
    shareStatusTimerRef.current = setTimeout(() => setShareStatus(null), status === 'copied' ? 2000 : 4000)
  }

  const handleJumpToLine = useCallback((lineNumber) => {
    if (lineNumber > 0 && inputEditorRef.current) inputEditorRef.current.scrollToLine(lineNumber)
  }, [])

  const handleToggleIssue = useCallback((globalIdx) => {
    setCollapsedIssues(prev => {
      const next = new Set(prev)
      if (next.has(globalIdx)) next.delete(globalIdx)
      else next.add(globalIdx)
      return next
    })
  }, [])

  // FEAT: apply a parsed fix directly to the input
  const handleApplyFix = useCallback((issue, fixLine) => {
    const lines = input.split('\n')
    // `issue` was computed by the 300ms-debounced validation in handleInputChange
    // against whatever `input` looked like back then — if the user types again
    // before that timer fires, the Issues panel (and the Apply fix button it
    // renders) still reflects that stale text while `input` here is already
    // current. Blindly overwriting lines[issue.lineNumber - 1] in that case
    // clobbers whatever unrelated line now sits at that index. Only apply when
    // the line is still exactly what the issue was raised against.
    if (
      issue.lineNumber > 0 && issue.lineNumber <= lines.length &&
      lines[issue.lineNumber - 1].trim() === issue.original
    ) {
      lines[issue.lineNumber - 1] = fixLine
      const newInput = lines.join('\n')
      setInput(newInput)
      clearTimeout(validateTimerRef.current)
      setResult(validateAdsTxt(newInput))
    }
  }, [input])

  // UX-02 FEAT: copy template line for a missing coverage network
  const handleCopyNetworkTemplate = async (network) => {
    const cert = DOMAIN_TO_CERT[network.domain]
    const line = cert
      ? `${network.domain}, YOUR_PUBLISHER_ID, DIRECT, ${cert}`
      : `${network.domain}, YOUR_PUBLISHER_ID, DIRECT`
    if (!(await copyText(line))) return
    // Same stale-timer race as shareStatusTimerRef above: copying network A's
    // template arms a 2s clear-timer, and copying network B's within that
    // window would arm a second, independent one — without clearing A's
    // first, A's timer still fires at its own t=2000 and wipes B's
    // still-valid "copied" feedback early.
    clearTimeout(copiedNetworkTimerRef.current)
    setCopiedNetwork(network.domain)
    copiedNetworkTimerRef.current = setTimeout(() => setCopiedNetwork(null), 2000)
  }

  const handleExpandAll  = () => setCollapsedIssues(new Set())
  const handleCollapseAll = () => result && setCollapsedIssues(new Set(result.issues.map((_, i) => i)))

  const issueCount = (s) => result?.issues.filter(i => i.severity === s).length ?? 0

  const filteredIssuesWithIdx = result?.issues
    .map((issue, i) => ({ issue, i }))
    .filter(({ issue }) => issueFilter === 'all' || issue.severity === issueFilter)
    ?? []

  const dataLineCount = useMemo(
    () => input.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length,
    [input]
  )
  const isLargeFile = dataLineCount > LARGE_FILE_THRESHOLD

  const health = useMemo(() => computeHealthScore(result?.stats), [result])
  const batchSummary = useMemo(() => batchResults.length ? summarizeBatch(batchResults) : null, [batchResults])

  // UX-07 FIX: dynamic output panel title
  const outputTitle = result && result.stats.errors > 0
    ? `Output (${result.stats.errors} error${result.stats.errors !== 1 ? 's' : ''})`
    : 'Cleaned Output'

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>app-ads.txt Validator</h1>
          <p>Validate, deduplicate and fix your app-ads.txt file</p>
        </div>
        <div className="header-right">
          <a
            className="help-link"
            href="https://iabtechlab.com/app-ads-txt/"
            target="_blank"
            rel="noopener noreferrer"
            title="IAB Tech Lab app-ads.txt specification"
          >
            ? IAB spec
          </a>
          <button
            className={`btn btn-ghost${shareStatus === 'copied' ? ' btn-success' : shareStatus ? ' btn-danger' : ''}`}
            onClick={handleShare}
            disabled={!input.trim()}
            title={shareStatus === 'too-large'
              ? 'File too large to share via URL (> ~75 KB) — download and share the file instead'
              : 'Copy shareable link to clipboard'}
            aria-live="polite"
          >
            {shareStatus === 'copied' ? '✓ Copied!'
              : shareStatus === 'too-large' ? '⚠ Too large to share'
              : shareStatus === 'failed' ? '⚠ Copy failed'
              : 'Share'}
          </button>
          <button
            className="btn btn-ghost dark-toggle"
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
      </header>

      <main className="main">

        {shareError && (
          <p className="file-error" role="alert">Could not open this share link — it looks corrupted or truncated.</p>
        )}

        {/* URL loader */}
        <div className="url-bar">
          <input
            className="url-input"
            type="url"
            placeholder="example.com or https://example.com/app-ads.txt  (Enter to load)"
            value={urlValue}
            onChange={e => { setUrlValue(e.target.value); setUrlError('') }}
            onKeyDown={e => e.key === 'Enter' && handleLoadUrl()}
          />
          <button className="btn btn-ghost" onClick={handleLoadUrl} disabled={!urlValue.trim() || urlLoading}>
            {urlLoading ? 'Loading…' : 'Load'}
          </button>
        </div>

        {/* UX-03 FIX: batch check is now a separate row, not crammed into the URL bar */}
        <div className="batch-toggle-row">
          <button
            className={`btn btn-ghost btn-sm${showBatch ? ' btn-active' : ''}`}
            onClick={() => setShowBatch(v => !v)}
            aria-expanded={showBatch}
          >
            {showBatch ? '▲' : '▼'} Batch URL check
          </button>
          <span className="batch-toggle-hint">Validate multiple app-ads.txt files at once</span>
        </div>

        <div className="batch-toggle-row">
          <button
            className={`btn btn-ghost btn-sm${showVersions ? ' btn-active' : ''}`}
            onClick={() => setShowVersions(v => !v)}
            aria-expanded={showVersions}
          >
            {showVersions ? '▲' : '▼'} Version history{versions.length > 0 ? ` (${versions.length})` : ''}
          </button>
          <span className="batch-toggle-hint">Save snapshots as you edit, then compare or restore any earlier version</span>
        </div>

        {urlError && <p className="url-error" role="alert">{urlError}</p>}
        {loadedUrl && !urlError && (
          <p className="loaded-url">
            <span className="loaded-url-label">Loaded from:</span>
            <span className="loaded-url-value">{loadedUrl}</span>
            <button className="loaded-url-clear" onClick={() => setLoadedUrl('')} aria-label="Clear loaded URL">×</button>
          </p>
        )}

        {/* BATCH CHECK */}
        {showBatch && (
          <div className="batch-panel">
            <div className="batch-header">
              <span className="panel-title">Batch URL Check</span>
              <p className="batch-hint">One URL per line — fetches and validates up to 5 at a time.</p>
            </div>
            <textarea
              className="batch-textarea"
              placeholder={'example.com\nhttps://another.com/app-ads.txt'}
              value={batchInput}
              onChange={e => setBatchInput(e.target.value)}
              aria-label="URLs to check, one per line"
              rows={4}
            />
            <div className="batch-actions">
              <button className="btn btn-primary" onClick={handleBatchCheck} disabled={!batchInput.trim() || batchLoading}>
                {batchLoading ? 'Checking…' : 'Check all URLs'}
              </button>
              {batchResults.length > 0 && (
                <button className="btn btn-ghost" onClick={handleBatchCsvExport} disabled={batchLoading}>
                  Export CSV
                </button>
              )}
              {batchResults.length > 0 && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    // Not disabled during batchLoading like the buttons above — this
                    // one doubles as "cancel": bumping batchGenRef makes handleBatchCheck's
                    // own finally skip its `setBatchLoading(false)` (its gen no longer
                    // matches), since that guard exists specifically to let a newer
                    // batch's own completion own the final state. Without resetting
                    // batchLoading here too, nothing else ever does — "Check all URLs"
                    // stayed disabled and stuck on "Checking…" forever, until reload.
                    setBatchResults([])
                    setBatchLoading(false)
                    batchGenRef.current++
                  }}
                >
                  Clear results
                </button>
              )}
            </div>
            {batchSummary && (
              <p className="batch-summary" aria-live="polite">
                <span>{batchSummary.total} checked</span>
                {batchSummary.clean > 0 && <span className="bs-clean">{batchSummary.clean} clean</span>}
                {batchSummary.withErrors > 0 && <span className="bs-errors">{batchSummary.withErrors} with errors</span>}
                {batchSummary.failed > 0 && <span className="bs-failed">{batchSummary.failed} failed to load</span>}
                {batchSummary.pending > 0 && <span className="bs-pending">{batchSummary.pending} pending</span>}
                {batchSummary.avgScore != null && <span>avg score {batchSummary.avgScore}</span>}
              </p>
            )}
            {batchResults.length > 0 && (
              <div className="batch-results">
                {batchResults.map((r, i) => (
                  <BatchResultRow key={i} item={r} onLoad={() => { loadText(r.content); setShowBatch(false) }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* VERSION HISTORY */}
        {showVersions && (
          <div className="versions-panel">
            <div className="batch-header">
              <span className="panel-title">Version History</span>
              <p className="batch-hint">Snapshots are saved locally in this browser — nothing leaves your machine.</p>
            </div>
            <div className="batch-actions">
              {/* aria-live mirrors the Share/Copy-output/Copy-network buttons elsewhere in
                  this file — without it, a screen reader user gets no announcement at all
                  of whether the save actually worked ("✓ Saved!" vs "⚠ Save failed"). */}
              <button className="btn btn-primary" onClick={handleSaveVersion} disabled={!input.trim() || versions[0]?.content === input} aria-live="polite">
                {savedFlash === 'saved' ? '✓ Saved!' : savedFlash === 'failed' ? '⚠ Save failed (storage full?)' : 'Save current as version'}
              </button>
              {versions.length > 0 && (
                <button className="btn btn-ghost" onClick={handleExportVersions}>Export history</button>
              )}
              {/* Unlike Export above, this must NOT be gated on versions.length > 0 — its whole
                  purpose is to ADD versions from a file, including bootstrapping history on a
                  browser/profile that doesn't have any yet (new machine, cleared storage, a
                  history file handed over by someone else). Gating it the same way as Export
                  made that impossible: with zero local versions, this button simply didn't
                  exist, and the empty-state message below didn't mention it as an option either.
                  aria-live same reasoning as Save current as version above. */}
              <button className="btn btn-ghost" onClick={() => versionFileInputRef.current.click()} aria-live="polite">
                {importFlash === 'invalid'
                  ? '⚠ Not a valid history file'
                  : importFlash
                    ? `✓ Imported ${importFlash.added}${importFlash.skipped > 0 ? ` (${importFlash.skipped} skipped)` : ''}`
                    : 'Import history'}
              </button>
              <input
                ref={versionFileInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={e => { handleImportVersions(e.target.files[0]); e.target.value = '' }}
              />
            </div>

            {versions.length === 0 ? (
              <p className="versions-empty">No saved versions yet — click "Save current as version" to start tracking changes over time, or "Import history" to load a previously exported file.</p>
            ) : (
              <div className="versions-list">
                {versions.map(v => (
                  <VersionRow
                    key={v.id}
                    version={v}
                    isComparing={compareId === v.id}
                    onRestore={() => handleRestoreVersion(v)}
                    onCompare={() => handleCompareVersion(v)}
                    onRename={() => handleRenameVersion(v.id)}
                    onDelete={() => handleDeleteVersion(v.id)}
                  />
                ))}
              </div>
            )}

            {versionDiff && <VersionDiffView diff={versionDiff} />}
          </div>
        )}

        <div className="panels">

          {/* INPUT */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Input</span>
              <div className="panel-actions">
                <button className="btn btn-ghost" onClick={() => fileInputRef.current.click()}>Upload file</button>
                <button className="btn btn-ghost" onClick={() => {
                  // Without this, a debounced re-validation from
                  // handleInputChange still pending at click time fires
                  // ~300ms later and repopulates the output with a stale
                  // validation of the just-cleared text.
                  clearTimeout(validateTimerRef.current)
                  setInput(''); setResult(null); setLoadedUrl('')
                  setSortOutput(false)  // BUG-02 FIX: reset sort on clear
                  // fileError (shown right above this same panel's editor) was
                  // the one piece of this panel's own state Clear left behind —
                  // a failed "Upload file" attempt kept its error message on
                  // screen indefinitely after Clear, outliving the very input
                  // it was about, until the next upload attempt happened to
                  // replace it.
                  setFileError('')
                }}>
                  Clear
                </button>
                <input ref={fileInputRef} type="file" accept=".txt,text/plain" hidden onChange={e => loadFile(e.target.files[0])} />
              </div>
            </div>

            {fileError && <p className="file-error" role="alert">{fileError}</p>}

            <GutterEditor
              ref={inputEditorRef}
              value={input}
              onChange={handleInputChange}
              onDrop={handleDrop}
              isDragging={isDragging}
              onDragOver={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
              lineIssues={result?.inputLineIssues}
              placeholder={PLACEHOLDER}
              ariaLabel="app-ads.txt input"
              onCtrlEnter={() => runValidation(input)}
            />

            <div className="panel-footer">
              <div className="footer-left">
                <span className="line-count">{dataLineCount} data lines</span>
                {isLargeFile && (
                  <span className="size-warning" title="Validation may take a moment for large files">
                    ⚠ Large file
                  </span>
                )}
              </div>
              <button className="btn btn-primary" onClick={() => runValidation(input)} disabled={!input.trim()}>
                Validate &amp; Clean →
              </button>
            </div>
          </div>

          {/* OUTPUT */}
          <div className="panel">
            {/* UX-08 FIX: sort toggle moved to header, separated from action buttons */}
            <div className="panel-header">
              <div className="panel-header-left">
                <span className="panel-title">{outputTitle}</span>
                <label className="sort-label">
                  <input type="checkbox" checked={sortOutput} onChange={e => setSortOutput(e.target.checked)} disabled={!result} />
                  Sort A–Z
                </label>
              </div>
              <div className="panel-actions">
                {/* aria-live mirrors the Share button above — this "✓ Copied!" text
                    swap is otherwise purely visual, so a screen reader user clicking
                    Copy never hears that the output was actually copied. */}
                <button className={`btn btn-ghost${copiedOutput ? ' btn-success' : ''}`} onClick={handleCopyOutput} disabled={!result} aria-live="polite">
                  {copiedOutput ? '✓ Copied!' : 'Copy'}
                </button>
                <button className="btn btn-ghost" onClick={handleDownload} disabled={!result}>Download .txt</button>
                <button className="btn btn-ghost" onClick={handleJsonExport} disabled={!result}>Export JSON</button>
              </div>
            </div>

            {result ? (
              <GutterEditor value={displayContent} readOnly lineStatuses={displayStatuses} placeholder="" ariaLabel="Cleaned output" />
            ) : (
              <div className="output-empty">
                <div className="output-empty-arrow">→</div>
                <p className="output-empty-title">Cleaned output appears here</p>
                <p className="output-empty-sub">
                  Paste or upload your app-ads.txt file on the left.<br />
                  Validation runs automatically as you type.<br />
                  Or press <kbd>Ctrl+Enter</kbd> to validate now.
                </p>
              </div>
            )}

            {result && (
              <div className="panel-footer stats-row">
                {health && (
                  // aria-label spells out what the bare "A"/"92" visual text can't:
                  // a title tooltip isn't reliably announced by screen readers and
                  // isn't reachable at all without a mouse (touch, keyboard-only),
                  // unlike every other stat/pill in this row, which is self-describing
                  // in its own visible text (e.g. "42 records", "3 errors"). The two
                  // inner spans are hidden from the accessibility tree so this label
                  // isn't read twice.
                  <span
                    className={`health-badge health-${health.grade.toLowerCase()}`}
                    title="File quality score: −10 per error, −3 per warning, −2 per duplicate"
                    aria-label={`File quality score: grade ${health.grade}, ${health.score} out of 100`}
                  >
                    <span className="health-grade" aria-hidden="true">{health.grade}</span>
                    <span className="health-score" aria-hidden="true">{health.score}</span>
                  </span>
                )}
                <span className="stat"><strong>{result.stats.keptRecords}</strong> records</span>
                {result.stats.directCount > 0 &&
                  <span className="stat stat-muted"><strong>{result.stats.directCount}</strong> DIRECT</span>}
                {result.stats.resellerCount > 0 &&
                  <span className="stat stat-muted"><strong>{result.stats.resellerCount}</strong> RESELLER</span>}
                {result.stats.errors > 0 &&
                  <span className="stat stat-error"><strong>{result.stats.errors}</strong> errors</span>}
                {result.stats.warnings > 0 &&
                  <span className="stat stat-warning"><strong>{result.stats.warnings}</strong> warnings</span>}
                {result.stats.duplicatesRemoved > 0 &&
                  <span className="stat stat-dupe"><strong>{result.stats.duplicatesRemoved}</strong> dupes removed</span>}
                {result.stats.certsAdded > 0 &&
                  <span className="stat stat-filled"><strong>{result.stats.certsAdded}</strong> certs added</span>}
                {result.stats.errors === 0 && result.stats.warnings === 0 && result.stats.duplicatesRemoved === 0 && result.stats.certsAdded === 0 &&
                  <span className="stat stat-clean">✓ All clean</span>}
              </div>
            )}
          </div>
        </div>

        {/* DIFF / CHANGES VIEW */}
        {result && result.changes.length > 0 && (
          <div className="diff-panel">
            <button className="diff-toggle" onClick={() => setShowDiff(v => !v)} aria-expanded={showDiff}>
              <span className="panel-title">Changes</span>
              <span className="diff-summary">
                {result.changes.filter(c => c.type === 'duplicate').length > 0 &&
                  <span className="diff-pill pill-dupe">{result.changes.filter(c => c.type === 'duplicate').length} removed</span>}
                {result.changes.filter(c => c.type === 'cert-added').length > 0 &&
                  <span className="diff-pill pill-filled">{result.changes.filter(c => c.type === 'cert-added').length} certs added</span>}
                {result.changes.filter(c => c.type === 'corrected').length > 0 &&
                  <span className="diff-pill pill-corrected">{result.changes.filter(c => c.type === 'corrected').length} normalized</span>}
              </span>
              <span className="diff-chevron">{showDiff ? '▲' : '▼'}</span>
            </button>
            {showDiff && (
              <div className="diff-list">
                <div className="diff-list-header">
                  <span>Line</span>
                  <span>Original</span>
                  <span>Cleaned</span>
                  <span>Change</span>
                </div>
                {result.changes.map((change, i) => (
                  <DiffRow key={i} change={change} onJumpToLine={handleJumpToLine} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ISSUES */}
        {result && result.issues.length > 0 && (
          <div className="issues-panel">
            <div className="issues-header">
              <span className="panel-title">Issues ({result.issues.length})</span>
              <div className="issues-header-right">
                <div className="expand-controls">
                  <button className="btn btn-ghost btn-xs" onClick={handleExpandAll}>Expand all</button>
                  <button className="btn btn-ghost btn-xs" onClick={handleCollapseAll}>Collapse all</button>
                </div>
                {/* role="group" + aria-pressed, same pattern as the Compare
                    button's own aria-pressed fix: "active" here is a CSS
                    class only a sighted user can see — without these, a
                    screen reader user tabbing through "All"/"Errors"/
                    "Warnings"/… hears five plain buttons with no indication
                    of which filter is currently selected. */}
                <div className="filter-tabs" role="group" aria-label="Filter issues by type">
                  {[
                    { key: 'all',       label: `All (${result.issues.length})` },
                    { key: 'error',     label: `Errors (${issueCount('error')})`,         show: issueCount('error') > 0 },
                    { key: 'warning',   label: `Warnings (${issueCount('warning')})`,     show: issueCount('warning') > 0 },
                    { key: 'duplicate', label: `Duplicates (${issueCount('duplicate')})`, show: issueCount('duplicate') > 0 },
                    { key: 'filled',    label: `Certs added (${issueCount('filled')})`,   show: issueCount('filled') > 0 },
                  ].filter(t => t.key === 'all' || t.show).map(tab => (
                    <button
                      key={tab.key}
                      className={`filter-tab${issueFilter === tab.key ? ' active' : ''}`}
                      aria-pressed={issueFilter === tab.key}
                      onClick={() => setIssueFilter(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="issues-list">
              {filteredIssuesWithIdx.map(({ issue, i }) => (
                <IssueCard
                  key={i}
                  issue={issue}
                  expanded={!collapsedIssues.has(i)}
                  onToggle={() => handleToggleIssue(i)}
                  onJumpToLine={handleJumpToLine}
                  onApplyFix={handleApplyFix}
                />
              ))}
            </div>
          </div>
        )}

        {result && result.issues.length === 0 && (
          <div className="clean-banner">✓ No issues found — your file is valid!</div>
        )}

        {/* NETWORK COVERAGE */}
        {result && result.stats.totalRecords > 0 && (
          <div className="coverage-panel">
            <button className="coverage-toggle" onClick={() => setShowCoverage(v => !v)} aria-expanded={showCoverage}>
              <span className="panel-title">Network Coverage</span>
              <span className="coverage-summary">
                {result.coverage.present.length} / {TOP_NETWORKS.length} top networks present
              </span>
              <span className="coverage-chevron">{showCoverage ? '▲' : '▼'}</span>
            </button>
            {showCoverage && (
              <>
                <p className="coverage-hint">
                  Missing networks: click to copy a ready-to-paste template line to your clipboard.
                </p>
                <div className="coverage-grid">
                  {TOP_NETWORKS.map(n => {
                    const present = result.coverage.present.some(p => p.domain === n.domain)
                    const wasCopied = copiedNetwork === n.domain
                    // UX-01 FIX: ✗ for missing, ✓ for present
                    const content = (
                      <>
                        <span className="coverage-icon">
                          {wasCopied ? '✓' : present ? '✓' : '✗'}
                        </span>
                        <span className="coverage-name">{n.name}</span>
                        <span className="coverage-domain">{wasCopied ? 'copied!' : n.domain}</span>
                      </>
                    )
                    // Only the "missing" items are actually interactive (click to copy a
                    // template line) — a <div onClick> there was unreachable by keyboard
                    // and inoperable via Enter/Space, the same class of gap already fixed
                    // elsewhere in this file (see "BUG-09 FIX" below) for issue-top.
                    if (present) {
                      return <div key={n.domain} className="coverage-item present">{content}</div>
                    }
                    return (
                      <button
                        key={n.domain}
                        type="button"
                        className="coverage-item missing"
                        onClick={() => handleCopyNetworkTemplate(n)}
                        title={`Click to copy template line for ${n.name}`}
                        aria-live="polite"
                      >
                        {content}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

      </main>
    </div>
  )
}

/* ── Gutter + editor ──────────────────────────────────────────── */

const STATUS_COLOR = {
  error:     'gutter-error',
  warning:   'gutter-warning',
  duplicate: 'gutter-duplicate',
  corrected: 'gutter-corrected',
  filled:    'gutter-filled',
}

function countLines(text) {
  let n = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++
  return n
}

// Memoized so typing within a line doesn't re-render thousands of line numbers —
// it only updates when the line count or validation statuses change.
const Gutter = memo(forwardRef(function Gutter({ lineCount, lineIssues, lineStatuses }, ref) {
  const getLineCls = (i) => {
    if (lineIssues)   { const s = lineIssues.get(i + 1);  return s ? STATUS_COLOR[s] : '' }
    if (lineStatuses) { const s = lineStatuses[i];         return s ? STATUS_COLOR[s] : '' }
    return ''
  }
  return (
    <div className="gutter" ref={ref} aria-hidden="true">
      {Array.from({ length: lineCount }, (_, i) => (
        <div key={i} className={`gutter-line ${getLineCls(i)}`}>{i + 1}</div>
      ))}
    </div>
  )
}))

const GutterEditor = forwardRef(function GutterEditor({
  value, onChange, onDrop, onDragOver, onDragLeave, isDragging,
  lineIssues, lineStatuses, placeholder, readOnly, onCtrlEnter, ariaLabel
}, ref) {
  const textareaRef = useRef()
  const gutterRef   = useRef()
  const lineCount = useMemo(() => countLines(value), [value])

  const syncScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current)
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
  }, [])

  useEffect(() => { syncScroll() }, [value, syncScroll])

  useImperativeHandle(ref, () => ({
    scrollToLine(lineNum) {
      if (!textareaRef.current) return
      const target = Math.max(0, (lineNum - 1) * 22 - 120)
      textareaRef.current.scrollTop = target
      if (gutterRef.current) gutterRef.current.scrollTop = target
      // .focus() alone restores whatever selection/caret the textarea already
      // had (e.g. from the last edit) — it does NOT move it to this line. A
      // keyboard/AT user who clicks "Jump to this line" then lands on the
      // right line visually but their caret is still wherever it was before,
      // so Home/End/arrow keys or immediate typing act on the WRONG line.
      // Selecting the line's own text makes the jump actually land there.
      const lines = value.split('\n')
      let offset = 0
      for (let i = 0; i < lineNum - 1 && i < lines.length; i++) offset += lines[i].length + 1
      const lineLength = lines[lineNum - 1]?.length ?? 0
      textareaRef.current.setSelectionRange(offset, offset + lineLength)
      textareaRef.current.focus()
    }
  }), [value])

  return (
    <div className="gutter-wrap">
      <Gutter ref={gutterRef} lineCount={lineCount} lineIssues={lineIssues} lineStatuses={lineStatuses} />
      <textarea
        ref={textareaRef}
        className={`editor${isDragging ? ' editor-drag' : ''}${readOnly ? ' editor-output' : ''}`}
        value={value}
        onChange={onChange}
        onScroll={syncScroll}
        onDrop={onDrop}
        onDragOver={onDragOver ? (e) => { e.preventDefault(); onDragOver() } : undefined}
        onDragLeave={onDragLeave}
        placeholder={placeholder}
        aria-label={ariaLabel}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            onCtrlEnter?.()
          }
        }}
      />
    </div>
  )
})

/* ── Diff row ─────────────────────────────────────────────────── */

const DIFF_META = {
  'duplicate':  { label: 'Removed',    cls: 'dupe' },
  'cert-added': { label: 'Cert added', cls: 'filled' },
  'corrected':  { label: 'Normalized', cls: 'corrected' },
}

function DiffRow({ change, onJumpToLine }) {
  const meta = DIFF_META[change.type] ?? { label: change.type, cls: 'info' }
  return (
    <div className={`diff-row diff-row-${meta.cls}`}>
      {/* Visible text is a bare number ("42"), so its accessible name
          defaulted to the same thing — indistinguishable from the plain,
          non-interactive line numbers shown elsewhere (e.g. IssueCard's own
          jump button at least says "Line 42"). Same gap as the version-rename
          button fixed earlier: title isn't reliably read by screen readers. */}
      <button
        type="button"
        className="diff-lineno"
        title="Jump to this line"
        aria-label={`Jump to line ${change.lineNumber}`}
        onClick={() => onJumpToLine?.(change.lineNumber)}
      >
        {change.lineNumber}
      </button>
      <code className="diff-original">{change.original}</code>
      {change.cleaned !== null
        ? <code className="diff-cleaned">{change.cleaned}</code>
        : <span className="diff-removed-label">— removed —</span>
      }
      <span className={`diff-tag diff-tag-${meta.cls}`}>{meta.label}</span>
    </div>
  )
}

/* ── Batch result row ─────────────────────────────────────────── */

function BatchResultRow({ item, onLoad }) {
  const [copiedUrl, setCopiedUrl] = useState(false)
  const copiedUrlTimerRef = useRef()

  const handleCopyUrl = async (e) => {
    e.stopPropagation()
    if (!(await copyText(item.url))) return
    // Same stale-timer race as handleCopyOutput/shareStatusTimerRef above:
    // clicking Copy twice within 2s without clearing the first timer lets
    // it fire at its own t=2000 and hide the "Copied!" flash early.
    clearTimeout(copiedUrlTimerRef.current)
    setCopiedUrl(true)
    copiedUrlTimerRef.current = setTimeout(() => setCopiedUrl(false), 2000)
  }

  if (item.status === 'loading') {
    return (
      <div className="batch-row batch-row-loading">
        <span className="batch-status-icon">⏳</span>
        <span className="batch-url">{item.url}</span>
        <span className="batch-status-text">Loading…</span>
      </div>
    )
  }
  if (item.status === 'error') {
    return (
      <div className="batch-row batch-row-error">
        <span className="batch-status-icon">✗</span>
        <span className="batch-url" title={item.url}>{item.url}</span>
        <span className="batch-status-text">{item.error}</span>
        {/* UX-06 FIX: copy URL button */}
        {/* aria-live mirrors the Share/Copy-output buttons — otherwise this
            '✓' swap is purely visual and a screen reader user hears nothing. */}
        <button className="btn btn-ghost btn-xs" onClick={handleCopyUrl} aria-live="polite">{copiedUrl ? '✓' : 'Copy URL'}</button>
      </div>
    )
  }
  const { stats } = item.result
  const hasErrors = stats.errors > 0
  const hasWarnings = stats.warnings > 0
  return (
    <div className={`batch-row batch-row-${hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok'}`}>
      <span className="batch-status-icon">{hasErrors ? '✗' : hasWarnings ? '⚠' : '✓'}</span>
      <span className="batch-url" title={item.url}>{item.url}</span>
      <span className="batch-stats">
        {stats.keptRecords} records
        {stats.errors > 0 && <span className="batch-stat-error"> · {stats.errors} errors</span>}
        {stats.warnings > 0 && <span className="batch-stat-warning"> · {stats.warnings} warnings</span>}
        {stats.duplicatesRemoved > 0 && <span> · {stats.duplicatesRemoved} dupes</span>}
        {stats.certsAdded > 0 && <span> · {stats.certsAdded} certs added</span>}
      </span>
      {/* UX-06 FIX: copy URL button on success rows too */}
      <button className="btn btn-ghost btn-xs" onClick={handleCopyUrl} aria-live="polite">{copiedUrl ? '✓' : 'Copy URL'}</button>
      <button className="btn btn-ghost btn-xs batch-load-btn" onClick={onLoad}>Load</button>
    </div>
  )
}

/* ── Issue card ───────────────────────────────────────────────── */

function IssueCard({ issue, expanded, onToggle, onJumpToLine, onApplyFix }) {
  const meta = {
    error:     { label: 'Error',      cls: 'error' },
    warning:   { label: 'Warning',    cls: 'warning' },
    duplicate: { label: 'Duplicate',  cls: 'duplicate' },
    filled:    { label: 'Cert added', cls: 'filled' },
  }[issue.severity] ?? { label: issue.severity, cls: 'info' }

  // FEAT: parse suggestion for auto-applicable fixes. Only "Change to:" is
  // ever emitted by validator.js as an auto-fixable suggestion (confirmed by
  // grepping every `suggestion:` literal there) — a "Remove invalid
  // characters:" alternative used to be matched here too but no suggestion
  // text has ever used that wording, so it was dead.
  const fixLine = issue.suggestion?.match(/Change to: (.+)$/)?.[1]

  return (
    <div className={`issue issue-${meta.cls}`}>
      {/* BUG-09 FIX: keyboard-accessible toggle. This can't be a real <button>
          itself: it has to contain the "jump to line" button below, and the
          HTML spec forbids interactive/tabindex descendants inside <button>
          (a role="button" span nested in a real <button> is invalid and can
          leave the inner control unreachable for keyboard/AT users) — same
          role="button" + tabIndex + key-handling substitute as PieceRow's
          piece-selection row in rozkroj, just on the outer element instead. */}
      <div
        className="issue-top"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          // Keydown bubbles, so without this check, pressing Enter/Space
          // while focus is on the nested "Jump to this line" <button> above
          // also fired HERE (toggling the card) in addition to — and via
          // preventDefault, INSTEAD of — the real button's own native
          // Enter/Space-activates-click behavior. The mouse-click equivalent
          // of this is already guarded (the inner button's onClick calls
          // e.stopPropagation()); this is the keydown counterpart, checked
          // on the outer element instead since a real <button> shouldn't
          // need a hand-rolled onKeyDown of its own.
          if (e.target !== e.currentTarget) return
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          onToggle()
        }}
        aria-expanded={expanded}
      >
        <div className="issue-left">
          <span className={`badge badge-${meta.cls}`}>{meta.label}</span>
          {issue.lineNumber > 0 && (
            <button
              type="button"
              className="issue-line issue-line-link"
              title="Jump to this line in the editor"
              onClick={e => { e.stopPropagation(); onJumpToLine?.(issue.lineNumber) }}
            >
              Line {issue.lineNumber}
            </button>
          )}
          <span className="issue-message">{issue.message}</span>
        </div>
        <span className="issue-toggle">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (issue.original || issue.suggestion) && (
        <div className="issue-body">
          {issue.original && (
            <div className="issue-code-block">
              <span className="code-label">Original</span>
              <code className="issue-code">{issue.original}</code>
            </div>
          )}
          {issue.suggestion && (
            <div className="issue-suggestion">
              <span className="suggestion-icon">💡</span>
              <span>{issue.suggestion}</span>
            </div>
          )}
          {fixLine && (
            <button
              type="button"
              className="apply-fix-btn"
              onClick={() => onApplyFix?.(issue, fixLine)}
            >
              ↑ Apply fix
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Version history ──────────────────────────────────────────── */

function VersionRow({ version, isComparing, onRestore, onCompare, onRename, onDelete }) {
  const s = version.stats
  return (
    <div className={`version-row${isComparing ? ' version-row-active' : ''}`}>
      <div className="version-info">
        {/* title alone isn't enough — same gap already fixed once in this file
            for the health-score badge: a title attribute is a mouse-hover
            tooltip, not reliably exposed to screen readers, and without an
            aria-label this button's accessible name defaults to its own
            visible text (the version's label, e.g. "Version 1") — identical
            to how VersionDiffView/the version list display that same label
            as plain, non-interactive text elsewhere on this page. A screen
            reader user tabbing to it heard nothing indicating this button
            performs a rename action at all, unlike Compare/Restore/Delete
            right next to it, whose own visible text already says what they do. */}
        <button
          type="button"
          className="version-label"
          onClick={onRename}
          title="Click to rename"
          aria-label={`Rename "${version.label}"`}
        >
          {version.label}
        </button>
        <span className="version-time">{formatVersionTime(version.timestamp)}</span>
        {s && (
          <span className="version-stats">
            {s.keptRecords} records
            {s.errors > 0 && <span className="batch-stat-error"> · {s.errors} errors</span>}
            {s.warnings > 0 && <span className="batch-stat-warning"> · {s.warnings} warnings</span>}
          </span>
        )}
      </div>
      <div className="version-actions">
        {/* aria-pressed matters here even though the label text already changes
            ("Compare to current" -> "✓ Comparing") — unlike aria-expanded (used
            for the Batch/Version History disclosure buttons above), a plain label
            swap on a non-toggle button gives assistive tech no indication this is
            a two-state control at all, only that its text happened to change.
            Every other toggle button in this app's sibling projects (rozkroj's
            UnitToggle/LanguageSwitcher, cwaniak's lang buttons) already exposes
            its state this way. */}
        <button
          className={`btn btn-ghost btn-xs${isComparing ? ' btn-active' : ''}`}
          onClick={onCompare}
          aria-pressed={isComparing}
        >
          {isComparing ? '✓ Comparing' : 'Compare to current'}
        </button>
        <button className="btn btn-ghost btn-xs" onClick={onRestore}>Restore</button>
        <button className="btn btn-ghost btn-xs version-delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}

function VersionDiffView({ diff }) {
  const { added, removed, certChanged, variablesAdded, variablesRemoved, variablesChanged, unchanged } = diff
  const hasChanges = added.length || removed.length || certChanged.length ||
    variablesAdded.length || variablesRemoved.length || variablesChanged.length

  if (!hasChanges) {
    return <p className="versions-empty">No differences — this version matches the current input ({unchanged} records unchanged).</p>
  }

  return (
    <div className="version-diff">
      <div className="version-diff-summary">
        {added.length > 0 && <span className="diff-pill pill-filled">+{added.length} added</span>}
        {removed.length > 0 && <span className="diff-pill pill-dupe">−{removed.length} removed</span>}
        {certChanged.length > 0 && <span className="diff-pill pill-corrected">{certChanged.length} cert changed</span>}
        {/* A version that only changed a variable (e.g. OWNERDOMAIN) — no record
            added/removed/cert-changed — triggered hasChanges above (so this expanded
            view shows instead of "No differences"), but until now had no pill here
            at all: the summary line showed just "N unchanged" with nothing to
            indicate a change happened, even though the variable diff below the fold
            does list it. */}
        {variablesAdded.length > 0 && <span className="diff-pill pill-filled">+{variablesAdded.length} vars added</span>}
        {variablesRemoved.length > 0 && <span className="diff-pill pill-dupe">−{variablesRemoved.length} vars removed</span>}
        {variablesChanged.length > 0 && <span className="diff-pill pill-corrected">{variablesChanged.length} vars changed</span>}
        <span className="version-diff-unchanged">{unchanged} unchanged</span>
      </div>
      <div className="version-diff-list">
        {variablesRemoved.map(({ name, value }) => (
          <code key={`vr-${name}`} className="version-diff-line diff-row-dupe">− {name}={value}</code>
        ))}
        {variablesAdded.map(({ name, value }) => (
          <code key={`va-${name}`} className="version-diff-line diff-row-filled">+ {name}={value}</code>
        ))}
        {variablesChanged.map(({ name, before, after }) => (
          <code key={`vc-${name}`} className="version-diff-line diff-row-corrected">± {name}: {before} → {after}</code>
        ))}
        {removed.map((r, i) => (
          <code key={`r-${i}`} className="version-diff-line diff-row-dupe">− {formatRecordLine(r)}</code>
        ))}
        {added.map((r, i) => (
          <code key={`a-${i}`} className="version-diff-line diff-row-filled">+ {formatRecordLine(r)}</code>
        ))}
        {certChanged.map(({ before, after }, i) => (
          <code key={`c-${i}`} className="version-diff-line diff-row-corrected">
            ± {after.domain}, {after.publisherId}, {after.relationship}: {before.certId || '(none)'} → {after.certId || '(none)'}
          </code>
        ))}
      </div>
    </div>
  )
}
