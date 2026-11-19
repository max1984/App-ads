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
  // Compare trimmed text, not the raw line: a malformed record kept verbatim (e.g. too
  // few fields, pushed as-is so the user can see and fix it) can carry original leading
  // whitespace, which would otherwise sort before every real domain and jump to the top
  // of the list regardless of its actual content.
  dataRows.sort((a, b) => a.line.trim().localeCompare(b.line.trim()))
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
// (domain, publisherId, relationship, certId), PLUS extensionData (the
// `;`-delimited trailing part of the line, carried on each record as
// `extensions`) — that's the order cleanedLine joins/appends them in,
// which is what sortCleanedOutput's full-line sort actually compares.
// validator.js's dedup key (recordKey) does NOT include extensionData, so
// two records can legitimately share domain+publisherId+relationship+cert
// and still both survive with different extensions — exactly the tie this
// field exists to break. If a field is ever added there, add it here too,
// in the same position, or this falls back out of sync with it again.
//
// Inline comments (e.g. "# note") are appended after extensionData in
// cleanedLine but are never stored on the record object, so two records
// tied on every field above but differing only by inline comment can still
// disagree with sortCleanedOutput's order — an accepted, currently
// unreachable-in-practice gap (comments aren't exported to JSON at all).
export function sortRecordsForExport(records) {
  return [...records].sort((a, b) =>
    a.domain.localeCompare(b.domain) ||
    a.publisherId.localeCompare(b.publisherId) ||
    a.relationship.localeCompare(b.relationship) ||
    (a.certId || '').localeCompare(b.certId || '') ||
    (a.extensions || '').localeCompare(b.extensions || '')
  )
}
