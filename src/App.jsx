import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { validateAdsTxt, TOP_NETWORKS } from './validator'
import './App.css'

const PLACEHOLDER = `# Paste your app-ads.txt content here
# or drag & drop / upload a .txt file

google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
appnexus.com, 1234, RESELLER, f5ab79cb980f11d1`

const LARGE_FILE_THRESHOLD = 2000  // data lines

async function fetchFromUrl(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch {
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    const res = await fetch(proxy, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  }
}

function encodeShare(str) {
  try { return btoa(unescape(encodeURIComponent(str))) } catch { return null }
}
function decodeShare(b64) {
  try { return decodeURIComponent(escape(atob(b64))) } catch { return null }
}

export default function App() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedOutput, setCopiedOutput] = useState(false)
  const [copiedShare, setCopiedShare] = useState(false)
  const [issueFilter, setIssueFilter] = useState('all')
  const [urlValue, setUrlValue] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState('')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [collapsedIssues, setCollapsedIssues] = useState(new Set())
  const [sortOutput, setSortOutput] = useState(false)
  const [showCoverage, setShowCoverage] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchResults, setBatchResults] = useState([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  )

  const fileInputRef = useRef()
  const inputEditorRef = useRef()
  const validateTimerRef = useRef()

  useEffect(() => {
    document.documentElement.setAttribute('data-dark', darkMode ? '1' : '')
  }, [darkMode])

  // Decode shared content from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const decoded = decodeShare(hash)
    if (decoded) {
      setInput(decoded)
      setResult(validateAdsTxt(decoded))
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => { setCollapsedIssues(new Set()) }, [result])

  const runValidation = useCallback((text) => {
    clearTimeout(validateTimerRef.current)
    if (!text.trim()) { setResult(null); return }
    setResult(validateAdsTxt(text))
  }, [])

  const handleInputChange = useCallback((e) => {
    const text = e.target.value
    setInput(text)
    clearTimeout(validateTimerRef.current)
    if (!text.trim()) { setResult(null); return }
    validateTimerRef.current = setTimeout(() => setResult(validateAdsTxt(text)), 300)
  }, [])

  const loadText = useCallback((text) => {
    setInput(text)
    setResult(validateAdsTxt(text))
  }, [])

  const loadFile = useCallback((file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => loadText(e.target.result)
    reader.readAsText(file, 'utf-8')
  }, [loadText])

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    loadFile(e.dataTransfer.files[0])
  }

  const handleLoadUrl = async () => {
    const url = urlValue.trim()
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

  // Batch URL check — fetches all URLs in parallel, updates results as each finishes
  const handleBatchCheck = async () => {
    const urls = batchInput.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    setBatchLoading(true)
    setBatchResults(urls.map(url => ({ url, status: 'loading', result: null, content: null, error: null })))
    await Promise.all(
      urls.map(async (url, i) => {
        try {
          const content = await fetchFromUrl(url)
          const r = validateAdsTxt(content)
          setBatchResults(prev => {
            const next = [...prev]
            next[i] = { url, status: 'done', result: r, content, error: null }
            return next
          })
        } catch (e) {
          setBatchResults(prev => {
            const next = [...prev]
            next[i] = { url, status: 'error', result: null, content: null, error: e.message }
            return next
          })
        }
      })
    )
    setBatchLoading(false)
  }

  const { displayContent, displayStatuses } = useMemo(() => {
    if (!result) return { displayContent: '', displayStatuses: [] }
    if (!sortOutput) return { displayContent: result.cleanedContent, displayStatuses: result.outputLineStatuses }
    const lines = result.cleanedContent.split('\n')
    const statuses = result.outputLineStatuses
    const headers = []
    const dataRows = []
    lines.forEach((line, i) => {
      const t = line.trim()
      if (!t || t.startsWith('#')) headers.push({ line, status: statuses[i] ?? null })
      else dataRows.push({ line, status: statuses[i] ?? null })
    })
    dataRows.sort((a, b) => a.line.localeCompare(b.line))
    const all = [...headers, ...dataRows]
    return { displayContent: all.map(r => r.line).join('\n'), displayStatuses: all.map(r => r.status) }
  }, [result, sortOutput])

  const handleCopyOutput = async () => {
    if (!result) return
    await navigator.clipboard.writeText(displayContent)
    setCopiedOutput(true)
    setTimeout(() => setCopiedOutput(false), 2000)
  }

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([displayContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'app-ads.txt'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleJsonExport = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result.records, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'app-ads.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleShare = async () => {
    if (!input.trim()) return
    const encoded = encodeShare(input)
    if (!encoded) return
    if (encoded.length > 100000) {
      alert('File too large to share via URL (> ~75 KB). Download and share the file directly.')
      return
    }
    const url = `${window.location.origin}${window.location.pathname}#${encoded}`
    await navigator.clipboard.writeText(url)
    setCopiedShare(true)
    setTimeout(() => setCopiedShare(false), 2000)
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

  const handleExpandAll  = () => setCollapsedIssues(new Set())
  const handleCollapseAll = () => result && setCollapsedIssues(new Set(result.issues.map((_, i) => i)))

  const issueCount = (s) => result?.issues.filter(i => i.severity === s).length ?? 0

  const filteredIssuesWithIdx = result?.issues
    .map((issue, i) => ({ issue, i }))
    .filter(({ issue }) => issueFilter === 'all' || issue.severity === issueFilter)
    ?? []

  const dataLineCount = input.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length
  const isLargeFile = dataLineCount > LARGE_FILE_THRESHOLD

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>app-ads.txt Validator</h1>
          <p>Validate, deduplicate and fix your app-ads.txt file</p>
        </div>
        <div className="header-right">
          <button
            className={`btn btn-ghost${copiedShare ? ' btn-success' : ''}`}
            onClick={handleShare}
            disabled={!input.trim()}
            title="Copy shareable link to clipboard"
          >
            {copiedShare ? '✓ Link copied!' : 'Share'}
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

        {/* URL loader */}
        <div className="url-bar">
          <input
            className="url-input"
            type="url"
            placeholder="https://example.com/app-ads.txt"
            value={urlValue}
            onChange={e => { setUrlValue(e.target.value); setUrlError('') }}
            onKeyDown={e => e.key === 'Enter' && handleLoadUrl()}
          />
          <button className="btn btn-ghost" onClick={handleLoadUrl} disabled={!urlValue.trim() || urlLoading}>
            {urlLoading ? 'Loading…' : 'Load from URL'}
          </button>
          <button
            className={`btn btn-ghost${showBatch ? ' btn-active' : ''}`}
            onClick={() => setShowBatch(v => !v)}
            title="Validate multiple URLs at once"
          >
            Batch check
          </button>
        </div>

        {urlError && <p className="url-error">{urlError}</p>}
        {loadedUrl && !urlError && (
          <p className="loaded-url">
            <span className="loaded-url-label">Loaded from:</span>
            <span className="loaded-url-value">{loadedUrl}</span>
            <button className="loaded-url-clear" onClick={() => setLoadedUrl('')}>×</button>
          </p>
        )}

        {/* BATCH CHECK */}
        {showBatch && (
          <div className="batch-panel">
            <div className="batch-header">
              <span className="panel-title">Batch URL Check</span>
              <p className="batch-hint">One URL per line — fetches and validates each file in parallel.</p>
            </div>
            <textarea
              className="batch-textarea"
              placeholder={'https://example.com/app-ads.txt\nhttps://another.com/app-ads.txt'}
              value={batchInput}
              onChange={e => setBatchInput(e.target.value)}
              rows={4}
            />
            <div className="batch-actions">
              <button
                className="btn btn-primary"
                onClick={handleBatchCheck}
                disabled={!batchInput.trim() || batchLoading}
              >
                {batchLoading ? 'Checking…' : 'Check all URLs'}
              </button>
              {batchResults.length > 0 && (
                <button className="btn btn-ghost" onClick={() => setBatchResults([])}>Clear results</button>
              )}
            </div>
            {batchResults.length > 0 && (
              <div className="batch-results">
                {batchResults.map((r, i) => (
                  <BatchResultRow key={i} item={r} onLoad={() => { loadText(r.content); setShowBatch(false) }} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="panels">

          {/* INPUT */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Input</span>
              <div className="panel-actions">
                <button className="btn btn-ghost" onClick={() => fileInputRef.current.click()}>Upload file</button>
                <button className="btn btn-ghost" onClick={() => { setInput(''); setResult(null); setLoadedUrl('') }}>Clear</button>
                <input ref={fileInputRef} type="file" accept=".txt,text/plain" hidden onChange={e => loadFile(e.target.files[0])} />
              </div>
            </div>

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
            <div className="panel-header">
              <span className="panel-title">Cleaned Output</span>
              <div className="panel-actions">
                <label className="sort-label">
                  <input type="checkbox" checked={sortOutput} onChange={e => setSortOutput(e.target.checked)} disabled={!result} />
                  Sort A–Z
                </label>
                <button className={`btn btn-ghost${copiedOutput ? ' btn-success' : ''}`} onClick={handleCopyOutput} disabled={!result}>
                  {copiedOutput ? '✓ Copied!' : 'Copy'}
                </button>
                <button className="btn btn-ghost" onClick={handleDownload} disabled={!result}>Download .txt</button>
                <button className="btn btn-ghost" onClick={handleJsonExport} disabled={!result}>Export JSON</button>
              </div>
            </div>

            {result ? (
              <GutterEditor
                value={displayContent}
                readOnly
                lineStatuses={displayStatuses}
                placeholder=""
              />
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
            <button className="diff-toggle" onClick={() => setShowDiff(v => !v)}>
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
                <div className="filter-tabs">
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
            <button className="coverage-toggle" onClick={() => setShowCoverage(v => !v)}>
              <span className="panel-title">Network Coverage</span>
              <span className="coverage-summary">
                {result.coverage.present.length} / {TOP_NETWORKS.length} top networks present
              </span>
              <span className="coverage-chevron">{showCoverage ? '▲' : '▼'}</span>
            </button>
            {showCoverage && (
              <div className="coverage-grid">
                {TOP_NETWORKS.map(n => {
                  const present = result.coverage.present.some(p => p.domain === n.domain)
                  return (
                    <div key={n.domain} className={`coverage-item${present ? ' present' : ' missing'}`}>
                      <span className="coverage-icon">{present ? '✓' : '○'}</span>
                      <span className="coverage-name">{n.name}</span>
                      <span className="coverage-domain">{n.domain}</span>
                    </div>
                  )
                })}
              </div>
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

const GutterEditor = forwardRef(function GutterEditor({
  value, onChange, onDrop, onDragOver, onDragLeave, isDragging,
  lineIssues, lineStatuses, placeholder, readOnly, onCtrlEnter
}, ref) {
  const textareaRef = useRef()
  const gutterRef   = useRef()
  const lines = value.split('\n')

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
      textareaRef.current.focus()
    }
  }), [])

  const getLineCls = (i) => {
    if (lineIssues)   { const s = lineIssues.get(i + 1);  return s ? STATUS_COLOR[s] : '' }
    if (lineStatuses) { const s = lineStatuses[i];         return s ? STATUS_COLOR[s] : '' }
    return ''
  }

  return (
    <div className="gutter-wrap">
      <div className="gutter" ref={gutterRef} aria-hidden="true">
        {lines.map((_, i) => (
          <div key={i} className={`gutter-line ${getLineCls(i)}`}>{i + 1}</div>
        ))}
      </div>
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
  'duplicate':  { label: 'Removed',     cls: 'dupe' },
  'cert-added': { label: 'Cert added',  cls: 'filled' },
  'corrected':  { label: 'Normalized',  cls: 'corrected' },
}

function DiffRow({ change, onJumpToLine }) {
  const meta = DIFF_META[change.type] ?? { label: change.type, cls: 'info' }
  return (
    <div className={`diff-row diff-row-${meta.cls}`}>
      <span
        className="diff-lineno"
        title="Jump to this line"
        onClick={() => onJumpToLine?.(change.lineNumber)}
      >
        {change.lineNumber}
      </span>
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
        <span className="batch-url">{item.url}</span>
        <span className="batch-status-text">{item.error}</span>
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
      <button className="btn btn-ghost btn-xs batch-load-btn" onClick={onLoad}>Load</button>
    </div>
  )
}

/* ── Issue card ───────────────────────────────────────────────── */

function IssueCard({ issue, expanded, onToggle, onJumpToLine }) {
  const meta = {
    error:     { label: 'Error',      cls: 'error' },
    warning:   { label: 'Warning',    cls: 'warning' },
    duplicate: { label: 'Duplicate',  cls: 'duplicate' },
    filled:    { label: 'Cert added', cls: 'filled' },
  }[issue.severity] ?? { label: issue.severity, cls: 'info' }

  return (
    <div className={`issue issue-${meta.cls}`}>
      <div className="issue-top" onClick={onToggle}>
        <div className="issue-left">
          <span className={`badge badge-${meta.cls}`}>{meta.label}</span>
          {issue.lineNumber > 0 && (
            <span
              className="issue-line issue-line-link"
              title="Jump to this line in the editor"
              onClick={e => { e.stopPropagation(); onJumpToLine?.(issue.lineNumber) }}
            >
              Line {issue.lineNumber}
            </span>
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
        </div>
      )}
    </div>
  )
}
