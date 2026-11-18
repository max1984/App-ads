import { describe, it, expect } from 'vitest'
import { validateAdsTxt, compareSnapshots } from '../validator.js'

// Deterministic PRNG (mulberry32) — a fixed seed keeps this test reproducible in CI
// instead of flaking on whichever random bytes Math.random() happens to produce.
function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeGenerators(rand) {
  const rnd = (n) => Math.floor(rand() * n)
  const pick = (arr) => arr[rnd(arr.length)]

  const domains = ['google.com', 'example.com', 'foo.com', 'a.b.c.com', '', 'HTTP://Google.com/x', 'exa mple.com', 'sub.domain', '...', 'a'.repeat(300)]
  const pubIds = ['pub-123', '', '  ', 'ABC=DEF', 'id,with,comma', 'tab\there']
  const rels = ['DIRECT', 'RESELLER', 'direct', 'weird', 'indirect', '']
  const certs = ['f08c47fec0942fa0', '', 'XYZ', '0123456789abcdef', 'c3e20eee3f780d68']
  const vars = ['OWNERDOMAIN', 'MANAGERDOMAIN', 'CONTACT', 'SUBDOMAIN', 'INVENTORYPARTNERDOMAIN', 'WEIRDVAR', 'ownerdomain']
  const seps = [',', ', ', ' ,', ' , ', ',,']
  const lineEnds = ['\n', '\r\n', '\r']

  function randomLine() {
    const kind = rnd(5)
    if (kind === 0) return `${pick(vars)}=${pick(domains)}${rand() < 0.3 ? ',' + pick(['US', 'XX', '1', '']) : ''}`
    if (kind === 1) {
      const parts = [pick(domains), pick(pubIds), pick(rels)]
      if (rand() < 0.6) parts.push(pick(certs))
      let line = parts.join(pick(seps))
      if (rand() < 0.3) line += ';' + pick(['ext=1', '', 'foo;bar'])
      if (rand() < 0.3) line += ' #' + pick(['comment', '', '#nested'])
      return line
    }
    if (kind === 2) return pick(['', '   ', '#just a comment', '# '])
    if (kind === 3) return `${pick(domains)}=${pick(domains)}=${pick(domains)}`
    return `${pick(domains)}, ${pick(pubIds)}`
  }

  function randomStructuredFile() {
    const n = 1 + rnd(12)
    const lines = []
    for (let i = 0; i < n; i++) lines.push(randomLine())
    return lines.join(pick(lineEnds))
  }

  function randChar() {
    const r = rand()
    if (r < 0.5) return String.fromCharCode(32 + rnd(95))
    if (r < 0.7) return pick([',', '=', ';', '#', '\n', '\r', '\t', ' ', '"', "'"])
    if (r < 0.85) return String.fromCharCode(0x00A0 + rnd(0x3000))
    if (r < 0.95) return String.fromCharCode(rnd(32))
    return String.fromCodePoint(0x1F600 + rnd(50))
  }

  function randomGarbageFile() {
    const n = rnd(400)
    let s = ''
    for (let i = 0; i < n; i++) s += randChar()
    return s
  }

  return { randomStructuredFile, randomGarbageFile }
}

// Property-based fuzzing, not seed-based unit tests: instead of asserting a specific
// output for a specific crafted input, this asserts invariants that must hold for
// EVERY input, structured or raw garbage — a crash or a non-fixed-point auto-fix would
// be a real bug even though no single one of these inputs was handpicked in advance.
describe('validateAdsTxt — fuzzing', () => {
  it('never throws and always reaches a fixed point (re-validating its own cleaned output changes nothing) on structured random files', () => {
    const rand = mulberry32(42)
    const { randomStructuredFile } = makeGenerators(rand)
    for (let i = 0; i < 3000; i++) {
      const content = randomStructuredFile()
      const r1 = validateAdsTxt(content)
      const r2 = validateAdsTxt(r1.cleanedContent)
      expect(r2.cleanedContent).toBe(r1.cleanedContent)
    }
  })

  it('never throws and always reaches a fixed point on raw random/garbage bytes (control chars, unicode, emoji)', () => {
    const rand = mulberry32(1337)
    const { randomGarbageFile } = makeGenerators(rand)
    for (let i = 0; i < 2000; i++) {
      const content = randomGarbageFile()
      const r1 = validateAdsTxt(content)
      const r2 = validateAdsTxt(r1.cleanedContent)
      expect(r2.cleanedContent).toBe(r1.cleanedContent)
    }
  })

  it('comparing any file against an identical copy of itself always reports zero differences', () => {
    const rand = mulberry32(99)
    const { randomStructuredFile, randomGarbageFile } = makeGenerators(rand)
    for (let i = 0; i < 1500; i++) {
      const content = i % 2 === 0 ? randomStructuredFile() : randomGarbageFile()
      const self = compareSnapshots(content, content)
      expect(self.added).toHaveLength(0)
      expect(self.removed).toHaveLength(0)
      expect(self.certChanged).toHaveLength(0)
      expect(self.variablesAdded).toHaveLength(0)
      expect(self.variablesRemoved).toHaveLength(0)
      expect(self.variablesChanged).toHaveLength(0)
    }
  })
})
