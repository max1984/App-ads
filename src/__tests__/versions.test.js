import { describe, it, expect } from 'vitest'
import { mergeImportedVersions, loadVersions, persistVersions, isValidVersion, VERSIONS_KEY } from '../versions.js'

const v = (id, timestamp, extra = {}) => ({ id, label: `V ${id}`, timestamp, content: 'a.com, 1, DIRECT', stats: null, ...extra })

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return { getItem: k => store.get(k) ?? null, setItem: (k, val) => store.set(k, val), _store: () => store }
}

describe('isValidVersion', () => {
  it('rejects entries with wrong types', () => {
    expect(isValidVersion(v('a', 1))).toBe(true)
    expect(isValidVersion(v('a', 1, { label: { x: 1 } }))).toBe(false)
    expect(isValidVersion(v('a', 'yesterday'))).toBe(false)
    expect(isValidVersion(null)).toBe(false)
  })
})

describe('mergeImportedVersions', () => {
  it('adds new valid versions, skips duplicates and invalid ones, sorts newest first', () => {
    const { versions, added, skipped } = mergeImportedVersions(
      [v('a', 1)],
      [v('a', 1), v('b', 3), v('c', 2, { content: 42 })]
    )
    expect(versions.map(x => x.id)).toEqual(['b', 'a'])
    expect(added).toBe(1)
    expect(skipped).toBe(2)
  })

  it('caps the list and strips unknown fields', () => {
    const { versions } = mergeImportedVersions([], [v('a', 1, { evil: '<script>' }), v('b', 2)], 1)
    expect(versions).toEqual([{ id: 'b', label: 'V b', timestamp: 2, content: 'a.com, 1, DIRECT', stats: null }])
  })

  it(
    'reports a valid, non-duplicate entry sliced off by the max-history cap as ' +
      'droppedForSpace, not silently uncounted by both added and skipped',
    () => {
      const { added, skipped, droppedForSpace } = mergeImportedVersions(
        [], [v('a', 1, { evil: '<script>' }), v('b', 2)], 1
      )
      expect(added).toBe(1)
      expect(skipped).toBe(0)
      expect(droppedForSpace).toBe(1)
    }
  )

  it('throws on non-array payloads', () => {
    expect(() => mergeImportedVersions([], { versions: [] })).toThrow(/not a version history/)
  })
})

describe('version storage', () => {
  it('drops corrupted entries on load', () => {
    const s = memoryStorage({ [VERSIONS_KEY]: JSON.stringify([v('a', 1), { id: 5 }]) })
    expect(loadVersions(s).map(x => x.id)).toEqual(['a'])
  })

  it('reports failure when storage throws (quota exceeded)', () => {
    expect(persistVersions([v('a', 1)], { setItem: () => { throw new Error('QuotaExceededError') } })).toBe(false)
    expect(persistVersions([v('a', 1)], memoryStorage())).toBe(true)
  })

  it('backs up corrupt JSON instead of letting the next save silently overwrite it', () => {
    const s = memoryStorage({ [VERSIONS_KEY]: '{not valid json' })
    expect(loadVersions(s)).toEqual([])
    const backupKey = [...s._store().keys()].find(k => k !== VERSIONS_KEY)
    expect(backupKey).toMatch(new RegExp(`^${VERSIONS_KEY}-corrupt-`))
    expect(s.getItem(backupKey)).toBe('{not valid json')
  })

  // Regression: `storage` used to default to `globalThis.localStorage` as a plain default
  // parameter, evaluated at call time BEFORE either function's try/catch runs. Some
  // privacy-locked-down browsing contexts (strict private mode, storage blocked by
  // browser/enterprise policy, certain sandboxed webviews) throw just from touching the
  // `localStorage` property — not only from getItem/setItem — which such a default parameter
  // can't catch. These must fall back to "no saved history" like any other storage failure,
  // not crash (this runs inside App.jsx's `useState(() => loadVersions())` initializer, with
  // no error boundary to catch an escaping exception).
  it('falls back instead of throwing when merely accessing localStorage is blocked (no storage argument passed)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: The operation is insecure.') },
    })
    try {
      expect(() => loadVersions()).not.toThrow()
      expect(loadVersions()).toEqual([])
      expect(() => persistVersions([v('a', 1)])).not.toThrow()
      expect(persistVersions([v('a', 1)])).toBe(false)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete globalThis.localStorage
    }
  })
})
