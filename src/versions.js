export const VERSIONS_KEY = 'app-ads-versions'
export const MAX_VERSIONS = 30

// Guards against hand-edited or foreign JSON: a non-string label would crash React rendering.
export function isValidVersion(v) {
  return !!v && typeof v === 'object' &&
    typeof v.id === 'string' && v.id !== '' &&
    typeof v.content === 'string' &&
    typeof v.label === 'string' &&
    Number.isFinite(v.timestamp)
}

function cleanVersion(v) {
  const s = v.stats
  const stats = s && typeof s === 'object' &&
    ['keptRecords', 'errors', 'warnings'].every(k => Number.isFinite(s[k]))
    ? { keptRecords: s.keptRecords, errors: s.errors, warnings: s.warnings }
    : null
  return { id: v.id, label: v.label, timestamp: v.timestamp, content: v.content, stats }
}

// Returns { versions, added, skipped }; throws if the payload isn't a version list at all.
export function mergeImportedVersions(existing, imported, max = MAX_VERSIONS) {
  if (!Array.isArray(imported)) throw new Error('not a version history file')
  const existingIds = new Set(existing.map(v => v.id))
  const fresh = []
  let skipped = 0
  for (const v of imported) {
    if (!isValidVersion(v) || existingIds.has(v.id)) { skipped++; continue }
    existingIds.add(v.id)
    fresh.push(cleanVersion(v))
  }
  const versions = [...existing, ...fresh].sort((a, b) => b.timestamp - a.timestamp).slice(0, max)
  return { versions, added: fresh.filter(v => versions.includes(v)).length, skipped }
}

export function loadVersions(storage = globalThis.localStorage) {
  const raw = storage.getItem(VERSIONS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidVersion).map(cleanVersion) : []
  } catch {
    // Corrupt JSON (not just an empty/missing key). The next persistVersions()
    // call (e.g. saving a new version) overwrites VERSIONS_KEY unconditionally
    // with whatever's in memory, which would silently and permanently destroy
    // this value — back it up under a different key first instead of losing it.
    try { storage.setItem(`${VERSIONS_KEY}-corrupt-${Date.now()}`, raw) } catch { /* best effort */ }
    return []
  }
}

// Returns false when the browser refused to store (quota exceeded, private mode…).
export function persistVersions(list, storage = globalThis.localStorage) {
  try {
    storage.setItem(VERSIONS_KEY, JSON.stringify(list))
    return true
  } catch { return false }
}
