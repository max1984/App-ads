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

// Returns { versions, added, skipped, droppedForSpace }; throws if the payload isn't a version list at all.
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
  const added = fresh.filter(v => versions.includes(v)).length
  // Valid, non-duplicate entries that still didn't make it in because the
  // merged list overflowed `max` and got sliced — distinct from `skipped`
  // above, which only counts entries that were never going to be kept at
  // all (invalid shape or a duplicate id). Without tracking this
  // separately, a caller surfacing "X added, Y skipped" to the user would
  // silently round-trip these: every imported entry would be accounted
  // for by neither count.
  const droppedForSpace = fresh.length - added
  return { versions, added, skipped, droppedForSpace }
}

// `storage` defaults to `globalThis.localStorage` INSIDE the try below, not as a default
// parameter value — a default parameter expression is evaluated at call time before the
// function body (and its try/catch) ever runs. Some privacy-locked-down browsing contexts
// (strict private-mode configurations, storage blocked by browser/enterprise policy, certain
// sandboxed webviews) throw a SecurityError on merely touching the `localStorage` property,
// not just on getItem/setItem. With a default parameter, that throw would happen before
// entering this function's try/catch at all and propagate straight out — and since this runs
// inside App.jsx's `useState(() => loadVersions())` initializer with no error boundary around
// it, that crashes the entire app to a blank page instead of just falling back to "no saved
// history", the same "best effort" fallback `loadStoredDarkMode`/`persistDarkMode` already
// give this exact failure mode elsewhere in App.jsx.
export function loadVersions(storage) {
  try {
    const s = storage ?? globalThis.localStorage
    const raw = s.getItem(VERSIONS_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isValidVersion).map(cleanVersion) : []
    } catch {
      // Corrupt JSON (not just an empty/missing key). The next persistVersions()
      // call (e.g. saving a new version) overwrites VERSIONS_KEY unconditionally
      // with whatever's in memory, which would silently and permanently destroy
      // this value — back it up under a different key first instead of losing it.
      try { s.setItem(`${VERSIONS_KEY}-corrupt-${Date.now()}`, raw) } catch { /* best effort */ }
      return []
    }
  } catch {
    return []
  }
}

// Returns false when the browser refused to store (quota exceeded, private mode, or
// `localStorage` itself unreachable — see loadVersions' comment above for why the fallback
// is resolved inside the try instead of as a default parameter).
export function persistVersions(list, storage) {
  try {
    const s = storage ?? globalThis.localStorage
    s.setItem(VERSIONS_KEY, JSON.stringify(list))
    return true
  } catch { return false }
}
