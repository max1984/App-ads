import { useState, useRef, useCallback, useEffect } from 'react'
import { validateAdsTxt } from './validator'
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
    // CORS or network — retry via proxy
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    const res = await fetch(proxy, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  }
}

export default function App() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedOutput, setCopiedOutput] = useState(false)
  const [issueFilter, setIssueFilter] = useState('all')
  const [urlValue, setUrlValue] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState('')
  const fileInputRef = useRef()

  const runValidation = useCallback((text) => {
    if (!text.trim()) { setResult(null); return }
    setResult(validateAdsTxt(text))
  }, [])

  const loadFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      setInput(text)
      setResult(validateAdsTxt(text))
    }
    reader.readAsText(file, 'utf-8')
  }

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
      setInput(text)
      setResult(validateAdsTxt(text))
      setUrlValue('')
    } catch (e) {
      setUrlError(`Failed to load: ${e.message}. Try pasting the content directly.`)
    } finally {
      setUrlLoading(false)
    }
  }

  const handleCopyOutput = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.cleanedContent)
    setCopiedOutput(true)
    setTimeout(() => setCopiedOutput(false), 2000)
  }

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([result.cleanedContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'app-ads.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredIssues = result?.issues.filter(i =>
    issueFilter === 'all' || i.severity === issueFilter
  ) ?? []

  const issueCount = (s) => result?.issues.filter(i => i.severity === s).length ?? 0

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>app-ads.txt Validator</h1>
          <p>Validate, deduplicate and fix your app-ads.txt file</p>
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

        <div className="panels">

          {/* INPUT */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Input</span>
              <div className="panel-actions">
                <button className="btn btn-ghost" onClick={() => fileInputRef.current.click()}>
                  Upload file
                </button>
                <button className="btn btn-ghost" onClick={() => { setInput(''); setResult(null) }}>
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
              value={input}
              onChange={e => setInput(e.target.value)}
              onDrop={handleDrop}
              isDragging={isDragging}
              onDragOver={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
              lineIssues={result?.inputLineIssues}
              placeholder={PLACEHOLDER}
            />

            <div className="panel-footer">
              <span className="line-count">
                {input.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length} data lines
              </span>
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
                <button
                  className={`btn btn-ghost${copiedOutput ? ' btn-success' : ''}`}
                  onClick={handleCopyOutput}
                  disabled={!result}
                >
                  {copiedOutput ? '✓ Copied!' : 'Copy to clipboard'}
                </button>
                <button className="btn btn-ghost" onClick={handleDownload} disabled={!result}>
                  Download .txt
                </button>
              </div>
            </div>

            <GutterEditor
              value={result?.cleanedContent ?? ''}
              readOnly
              lineStatuses={result?.outputLineStatuses}
              placeholder="Cleaned output appears here after validation…"
            />

            {result && (
              <div className="panel-footer stats-row">
                <span className="stat"><strong>{result.stats.keptRecords}</strong> records</span>
                {result.stats.errors > 0 &&
                  <span className="stat stat-error"><strong>{result.stats.errors}</strong> errors</span>}
                {result.stats.warnings > 0 &&
                  <span className="stat stat-warning"><strong>{result.stats.warnings}</strong> warnings</span>}
                {result.stats.duplicatesRemoved > 0 &&
                  <span className="stat stat-dupe"><strong>{result.stats.duplicatesRemoved}</strong> dupes removed</span>}
                {result.stats.errors === 0 && result.stats.warnings === 0 && result.stats.duplicatesRemoved === 0 &&
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
              <div className="filter-tabs">
                {[
                  { key: 'all',       label: `All (${result.issues.length})` },
                  { key: 'error',     label: `Errors (${issueCount('error')})`,         show: issueCount('error') > 0 },
                  { key: 'warning',   label: `Warnings (${issueCount('warning')})`,     show: issueCount('warning') > 0 },
                  { key: 'duplicate', label: `Duplicates (${issueCount('duplicate')})`, show: issueCount('duplicate') > 0 },
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
            <div className="issues-list">
              {filteredIssues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
            </div>
          </div>
        )}

        {result && result.issues.length === 0 && (
          <div className="clean-banner">✓ No issues found — your file is valid!</div>
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
}

function GutterEditor({
  value, onChange, onDrop, onDragOver, onDragLeave, isDragging,
  lineIssues,   // Map<lineNumber, severity> — for input
  lineStatuses, // Array<status|null>        — for output
  placeholder, readOnly
}) {
  const textareaRef = useRef()
  const gutterRef   = useRef()
  const lines = value.split('\n')

  const syncScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  // Re-sync when content changes (e.g. initial load)
  useEffect(() => { syncScroll() }, [value])

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
      />
    </div>
  )
}

/* ── Issue card ───────────────────────────────────────────────── */

function IssueCard({ issue }) {
  const [expanded, setExpanded] = useState(true)
  const meta = {
    error:     { label: 'Error',     cls: 'error' },
    warning:   { label: 'Warning',   cls: 'warning' },
    duplicate: { label: 'Duplicate', cls: 'duplicate' },
  }[issue.severity] ?? { label: issue.severity, cls: 'info' }

  return (
    <div className={`issue issue-${meta.cls}`}>
      <div className="issue-top" onClick={() => setExpanded(v => !v)}>
        <div className="issue-left">
          <span className={`badge badge-${meta.cls}`}>{meta.label}</span>
          {issue.lineNumber > 0 && <span className="issue-line">Line {issue.lineNumber}</span>}
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
