import { useState, useRef, useCallback } from 'react'
import { validateAdsTxt } from './validator'
import './App.css'

const PLACEHOLDER = `# Paste your app-ads.txt content here
# or drag & drop a .txt file onto this area

google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
appnexus.com, 1234, RESELLER, f5ab79cb980f11d1`

export default function App() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copiedOutput, setCopiedOutput] = useState(false)
  const [issueFilter, setIssueFilter] = useState('all')
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
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
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

  const filteredIssues = result?.issues.filter(i => {
    if (issueFilter === 'all') return true
    return i.severity === issueFilter
  }) ?? []

  const issueCount = (severity) => result?.issues.filter(i => i.severity === severity).length ?? 0

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div>
            <h1>app-ads.txt Validator</h1>
            <p>Validate, deduplicate and fix your app-ads.txt file</p>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="panels">

          {/* INPUT PANEL */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Input</span>
              <div className="panel-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => fileInputRef.current.click()}
                  title="Upload a .txt file"
                >
                  Upload file
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setInput(''); setResult(null) }}
                >
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

            <textarea
              className={`editor${isDragging ? ' editor-drag' : ''}`}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
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

          {/* OUTPUT PANEL */}
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
                <button
                  className="btn btn-ghost"
                  onClick={handleDownload}
                  disabled={!result}
                >
                  Download .txt
                </button>
              </div>
            </div>

            <textarea
              className="editor editor-output"
              value={result?.cleanedContent ?? ''}
              readOnly
              placeholder="Cleaned output appears here after validation…"
              spellCheck={false}
            />

            {result && (
              <div className="panel-footer stats-row">
                <span className="stat">
                  <strong>{result.stats.keptRecords}</strong> records kept
                </span>
                {result.stats.errors > 0 && (
                  <span className="stat stat-error">
                    <strong>{result.stats.errors}</strong> errors
                  </span>
                )}
                {result.stats.warnings > 0 && (
                  <span className="stat stat-warning">
                    <strong>{result.stats.warnings}</strong> warnings
                  </span>
                )}
                {result.stats.duplicatesRemoved > 0 && (
                  <span className="stat stat-dupe">
                    <strong>{result.stats.duplicatesRemoved}</strong> dupes removed
                  </span>
                )}
                {result.stats.errors === 0 && result.stats.warnings === 0 && result.stats.duplicatesRemoved === 0 && (
                  <span className="stat stat-clean">✓ All clean</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ISSUES PANEL */}
        {result && result.issues.length > 0 && (
          <div className="issues-panel">
            <div className="issues-header">
              <span className="panel-title">Issues ({result.issues.length})</span>
              <div className="filter-tabs">
                {[
                  { key: 'all', label: `All (${result.issues.length})` },
                  { key: 'error', label: `Errors (${issueCount('error')})` },
                  { key: 'warning', label: `Warnings (${issueCount('warning')})` },
                  { key: 'duplicate', label: `Duplicates (${issueCount('duplicate')})` },
                ].filter(t => t.key === 'all' || (t.key === 'error' && issueCount('error') > 0) || (t.key === 'warning' && issueCount('warning') > 0) || (t.key === 'duplicate' && issueCount('duplicate') > 0))
                  .map(tab => (
                    <button
                      key={tab.key}
                      className={`filter-tab${issueFilter === tab.key ? ' active' : ''}`}
                      onClick={() => setIssueFilter(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))
                }
              </div>
            </div>

            <div className="issues-list">
              {filteredIssues.map((issue, i) => (
                <IssueCard key={i} issue={issue} />
              ))}
              {filteredIssues.length === 0 && (
                <p className="no-issues">No issues in this category.</p>
              )}
            </div>
          </div>
        )}

        {result && result.issues.length === 0 && (
          <div className="clean-banner">
            ✓ No issues found — your file is valid!
          </div>
        )}
      </main>
    </div>
  )
}

function IssueCard({ issue }) {
  const [expanded, setExpanded] = useState(true)

  const meta = {
    error:     { label: 'Error',     cls: 'error' },
    warning:   { label: 'Warning',   cls: 'warning' },
    duplicate: { label: 'Duplicate', cls: 'duplicate' },
    info:      { label: 'Info',      cls: 'info' },
  }[issue.severity] ?? { label: issue.severity, cls: 'info' }

  return (
    <div className={`issue issue-${meta.cls}`}>
      <div className="issue-top" onClick={() => setExpanded(v => !v)}>
        <div className="issue-left">
          <span className={`badge badge-${meta.cls}`}>{meta.label}</span>
          {issue.lineNumber > 0 && (
            <span className="issue-line">Line {issue.lineNumber}</span>
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
