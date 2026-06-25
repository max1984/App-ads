import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { validateAdsTxt, TOP_NETWORKS } from './validator'
import './App.css'

const PLACEHOLDER = `# Paste your app-ads.txt content here
# or drag & drop / upload a .txt file

google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
appnexus.com, 1234, RESELLER, f5ab79cb980f11d1`

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
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  )

  const fileInputRef = useRef()
  const inputEditorRef = useRef()
  const validateTimerRef = useRef()

  // Apply dark mode to document root
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

  // Reset expanded state when result or filter changes
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
    validateTimerRef.current = setTimeout(() => {
      setResult(validateAdsTxt(text))
    }, 300)
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
    a.href = url
    a.download = 'app-ads.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleJsonExport = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result.records, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'app-ads.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleShare = async () => {
    if (!input.trim()) return
    const encoded = encodeShare(input)
    if (!encoded) return
    if (encoded.length > 100000) {
      alert('File is too large to share via URL (> ~75 KB). Download and share the file directly instead.')
      return
    }
    const url = `${window.location.origin}${window.location.pathname}#${encoded}`
    await navigator.clipboard.writeText(url)
    setCopiedShare(true)
    setTimeout(() => setCopiedShare(false), 2000)
  }

  const handleJumpToLine = useCallback((lineNumber) => {
    if (lineNumber > 0 && inputEditorRef.current) {
      inputEditorRef.current.scrollToLine(lineNumber)
    }
  }, [])

  const handleToggleIssue = useCallback((globalIdx) => {
    setCollapsedIssues(prev => {
      const next = new Set(prev)
      if (next.has(globalIdx)) next.delete(globalIdx)
      else next.add(globalIdx)
      return next
    })
  }, [])

  const handleExpandAll = () => setCollapsedIssues(new Set())
  const handleCollapseAll = () => {
    if (!result) return
    setCollapsedIssues(new Set(result.issues.map((_, i) => i)))
  }

  // Sorted output (preserves gutter colours by re-pairing lines with their statuses)
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
    return {
      displayContent: all.map(r => r.line).join('\n'),
      displayStatuses: all.map(r => r.status),
    }
  }, [result, sortOutput])

  const issueCount = (s) => result?.issues.filter(i => i.severity === s).length ?? 0

  const filteredIssuesWithIdx = result?.issues
    .map((issue, i) => ({ issue, i }))
    .filter(({ issue }) => issueFilter === 'all' || issue.severity === issueFilter)
    ?? []

  const dataLineCount = input.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length

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
          <button
            className="btn btn-ghost"
            onClick={handleLoadUrl}
            disabled={!urlValue.trim() || urlLoading}
          >
            {urlLoading ? 'Loading…' : 'Load from URL'}
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

        <div className="panels">

          {/* INPUT */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Input</span>
              <div className="panel-actions">
                <button className="btn btn-ghost" onClick={() => fileInputRef.current.click()}>
                  Upload file
                </button>
                <button className="btn btn-ghost" onClick={() => { setInput(''); setResult(null); setLoadedUrl('') }}>
                  Clear
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  hidden
                  onChange={e => loadFile(e.target.files[0])}
                />
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
              <span className="line-count">{dataLineCount} data lines</span>
              <button
                className="btn btn-primary"
                onClick={() => runValidation(input)}
                disabled={!input.trim()}
              >
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
                  <input
                    type="checkbox"
                    checked={sortOutput}
                    onChange={e => setSortOutput(e.target.checked)}
                    disabled={!result}
                  />
                  Sort A–Z
                </label>
                <button
                  className={`btn btn-ghost${copiedOutput ? ' btn-success' : ''}`}
                  onClick={handleCopyOutput}
                  disabled={!result}
                >
                  {copiedOutput ? '✓ Copied!' : 'Copy'}
                </button>
                <button className="btn btn-ghost" onClick={handleDownload} disabled={!result}>
                  Download .txt
                </button>
                <button className="btn btn-ghost" onClick={handleJsonExport} disabled={!result}>
                  Export JSON
                </button>
              </div>
            </div>

            <GutterEditor
              value={displayContent}
              readOnly
              lineStatuses={displayStatuses}
              placeholder="Cleaned output appears here after validation…"
            />

            {result && (
              <div className="panel-footer stats-row">
                <span className="stat"><strong>{result.stats.keptRecords}</strong> records</span>
                {result.stats.directCount > 0 &&
                  <span className="stat stat-muted">
                    <strong>{result.stats.directCount}</strong> DIRECT
                  </span>}
                {result.stats.resellerCount > 0 &&
                  <span className="stat stat-muted">
                    <strong>{result.stats.resellerCount}</strong> RESELLER
                  </span>}
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
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  useEffect(() => { syncScroll() }, [value, syncScroll])

  useImperativeHandle(ref, () => ({
    scrollToLine(lineNum) {
      if (!textareaRef.current) return
      const lineHeight = 22
      const target = Math.max(0, (lineNum - 1) * lineHeight - 120)
      textareaRef.current.scrollTop = target
      if (gutterRef.current) gutterRef.current.scrollTop = target
      textareaRef.current.focus()
    }
  }), [])

  const getLineCls = (i) => {
    const lineNum = i + 1
    if (lineIssues) {
      const s = lineIssues.get(lineNum)
      return s ? STATUS_COLOR[s] : ''
    }
    if (lineStatuses) {
      const s = lineStatuses[i]
      return s ? STATUS_COLOR[s] : ''
    }
    return ''
  }

  return (
    <div className="gutter-wrap">
      <div className="gutter" ref={gutterRef} aria-hidden="true">
        {lines.map((_, i) => (
          <div key={i} className={`gutter-line ${getLineCls(i)}`}>
            {i + 1}
          </div>
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
