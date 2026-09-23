import { computeHealthScore } from './validator'

const COLUMNS = ['url', 'status', 'score', 'grade', 'records', 'direct', 'reseller', 'errors', 'warnings', 'duplicates', 'ownerdomain', 'error']

// RFC 4180 quoting, plus a leading apostrophe on cells that spreadsheets would
// otherwise execute as formulas (content comes from third-party servers).
function csvCell(value) {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function batchResultsToCsv(results) {
  const rows = results.map(({ url, status, result, error }) => {
    const stats = result?.stats
    const health = computeHealthScore(stats)
    return [
      url, status,
      health?.score, health?.grade,
      stats?.keptRecords, stats?.directCount, stats?.resellerCount,
      stats?.errors, stats?.warnings, stats?.duplicatesRemoved,
      result?.variables?.OWNERDOMAIN,
      error,
    ]
  })
  return [COLUMNS, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
