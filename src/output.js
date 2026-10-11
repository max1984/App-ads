const VARIABLE_LINE = /^[A-Za-z]+\s*=/

// Sorts cleaned output A–Z while keeping file structure intact: comments/blank lines
// first, then variable declarations (OWNERDOMAIN=… etc.) in original order, then records.
export function sortCleanedOutput(content, statuses = []) {
  const headers = [], variables = [], dataRows = []
  content.split('\n').forEach((line, i) => {
    const t = line.trim()
    const row = { line, status: statuses[i] ?? null }
    if (!t || t.startsWith('#')) headers.push(row)
    else if (VARIABLE_LINE.test(t)) variables.push(row)
    else dataRows.push(row)
  })
  dataRows.sort((a, b) => a.line.localeCompare(b.line))
  const all = [...headers, ...variables, ...dataRows]
  return { content: all.map(r => r.line).join('\n'), statuses: all.map(r => r.status) }
}

// Sorts parsed records the same way "Sort A-Z" orders the cleaned-output
// panel/.txt download, so the JSON export matches it. sortCleanedOutput
// above sorts by full LINE TEXT, which already breaks ties between two
// records sharing a domain by whatever comes after it (publisher ID,
// then relationship, then cert) — domain-only comparison left those ties
// to fall back to each record's position in the ORIGINAL file, which
// could (and for any publisher with multiple records per domain, would)
// disagree with the full-line order shown on screen.
// Field order here must match recordParts in validator.js's validateAdsTxt
// (domain, publisherId, relationship, certId) — that's the order cleanedLine
// joins them in, which is what sortCleanedOutput's full-line sort actually
// compares. If a field is ever added there, add it here too, in the same
// position, or this falls back out of sync with it again.
export function sortRecordsForExport(records) {
  return [...records].sort((a, b) =>
    a.domain.localeCompare(b.domain) ||
    a.publisherId.localeCompare(b.publisherId) ||
    a.relationship.localeCompare(b.relationship) ||
    (a.certId || '').localeCompare(b.certId || '')
  )
}
