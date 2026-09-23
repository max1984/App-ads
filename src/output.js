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
