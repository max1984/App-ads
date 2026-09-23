import { describe, it, expect } from 'vitest'
import { validateAdsTxt, compareSnapshots, formatRecordLine } from '../validator.js'

const OWNER = 'OWNERDOMAIN=example.com\n'

describe('validateAdsTxt — records', () => {
  it('normalizes domain and relationship case, preserves publisher ID case', () => {
    const r = validateAdsTxt(OWNER + 'Example.COM, PUB-ABC, direct')
    expect(r.cleanedContent.split('\n')[1]).toBe('example.com, PUB-ABC, DIRECT')
    expect(r.outputLineStatuses[1]).toBe('corrected')
    expect(r.changes).toHaveLength(1)
  })

  it('auto-fills known cert IDs', () => {
    const r = validateAdsTxt(OWNER + 'google.com, pub-1, DIRECT')
    expect(r.records[0].certId).toBe('f08c47fec0942fa0')
    expect(r.stats.certsAdded).toBe(1)
    expect(r.issues.some(i => i.severity === 'filled')).toBe(true)
  })

  it('removes duplicates, including one without cert vs one with cert', () => {
    const r = validateAdsTxt(OWNER + 'google.com, pub-1, DIRECT\ngoogle.com, pub-1, DIRECT, f08c47fec0942fa0')
    expect(r.stats.duplicatesRemoved).toBe(1)
    expect(r.stats.keptRecords).toBe(1)
  })

  it('does not merge DIRECT and RESELLER for same seller', () => {
    const r = validateAdsTxt(OWNER + 'foo.com, 1, DIRECT\nfoo.com, 1, RESELLER')
    expect(r.stats.duplicatesRemoved).toBe(0)
    expect(r.stats.directCount).toBe(1)
    expect(r.stats.resellerCount).toBe(1)
  })

  it('flags invalid relationship with a suggestion', () => {
    const r = validateAdsTxt(OWNER + 'foo.com, 1, directt')
    const err = r.issues.find(i => i.severity === 'error')
    expect(err.message).toMatch(/Invalid relationship/)
    expect(err.suggestion).toMatch(/DIRECT/)
  })

  it('flags too few fields', () => {
    const r = validateAdsTxt(OWNER + 'foo.com, 1')
    expect(r.stats.errors).toBe(1)
    expect(r.inputLineIssues.get(2)).toBe('error')
  })

  it('flags invalid domain', () => {
    const r = validateAdsTxt(OWNER + 'google, 1, DIRECT')
    expect(r.issues.some(i => /Invalid domain/.test(i.message))).toBe(true)
  })

  it('validates cert ID format and registry', () => {
    const bad = validateAdsTxt(OWNER + 'foo.com, 1, DIRECT, xyz')
    expect(bad.issues.some(i => i.severity === 'error' && /Cert ID/.test(i.message))).toBe(true)
    const unknown = validateAdsTxt(OWNER + 'foo.com, 1, DIRECT, 0123456789abcdef')
    expect(unknown.issues.some(i => i.severity === 'warning' && /not found/.test(i.message))).toBe(true)
  })

  it('keeps extension data after semicolon', () => {
    const r = validateAdsTxt(OWNER + 'foo.com, 1, DIRECT;ext=1')
    expect(r.cleanedContent).toContain('foo.com, 1, DIRECT;ext=1')
  })

  it('does not treat "=" inside a record field as a variable', () => {
    const r = validateAdsTxt(OWNER + 'foo.com, 1234=abc, DIRECT')
    expect(r.stats.totalRecords).toBe(1)
  })

  it('reports network coverage', () => {
    const r = validateAdsTxt(OWNER + 'google.com, pub-1, DIRECT')
    expect(r.coverage.present.map(n => n.domain)).toContain('google.com')
    expect(r.coverage.missing.map(n => n.domain)).not.toContain('google.com')
  })
})

describe('validateAdsTxt — variables', () => {
  it('warns when OWNERDOMAIN missing', () => {
    const r = validateAdsTxt('foo.com, 1, DIRECT')
    expect(r.issues.some(i => /No OWNERDOMAIN/.test(i.message))).toBe(true)
  })

  it('normalizes OWNERDOMAIN value', () => {
    const r = validateAdsTxt('ownerdomain=https://Example.com/path\nfoo.com, 1, DIRECT')
    expect(r.variables.OWNERDOMAIN).toBe('example.com')
    expect(r.cleanedContent.split('\n')[0]).toBe('OWNERDOMAIN=example.com')
  })

  it('errors on malformed OWNERDOMAIN', () => {
    const r = validateAdsTxt('OWNERDOMAIN=not a domain')
    expect(r.issues.some(i => i.severity === 'error' && /OWNERDOMAIN/.test(i.message))).toBe(true)
  })

  it('warns on multiple OWNERDOMAIN and unsupported variables', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com\nOWNERDOMAIN=b.com\nFOO=bar')
    expect(r.issues.some(i => /Multiple OWNERDOMAIN/.test(i.message))).toBe(true)
    expect(r.issues.some(i => /Unsupported variable 'FOO'/.test(i.message))).toBe(true)
  })

  it('errors on empty file', () => {
    const r = validateAdsTxt('# just a comment\n\n')
    expect(r.issues[0].lineNumber).toBe(-1)
    expect(r.issues[0].severity).toBe('error')
  })
})

describe('compareSnapshots', () => {
  it('detects added, removed, cert changes and variable changes', () => {
    const before = 'OWNERDOMAIN=a.com\nfoo.com, 1, DIRECT\nbar.com, 2, RESELLER, 0123456789abcdef'
    const after = 'OWNERDOMAIN=b.com\nbar.com, 2, RESELLER, fedcba9876543210\nbaz.com, 3, DIRECT'
    const d = compareSnapshots(before, after)
    expect(d.added.map(r => r.domain)).toEqual(['baz.com'])
    expect(d.removed.map(r => r.domain)).toEqual(['foo.com'])
    expect(d.certChanged).toHaveLength(1)
    expect(d.variablesChanged).toEqual([{ name: 'OWNERDOMAIN', before: 'a.com', after: 'b.com' }])
  })

  it('ignores record order', () => {
    const d = compareSnapshots('a.com, 1, DIRECT\nb.com, 2, DIRECT', 'b.com, 2, DIRECT\na.com, 1, DIRECT')
    expect(d.added).toHaveLength(0)
    expect(d.removed).toHaveLength(0)
    expect(d.unchanged).toBe(2)
  })
})

describe('formatRecordLine', () => {
  it('formats with and without cert', () => {
    expect(formatRecordLine({ domain: 'a.com', publisherId: '1', relationship: 'DIRECT', certId: '' })).toBe('a.com, 1, DIRECT')
    expect(formatRecordLine({ domain: 'a.com', publisherId: '1', relationship: 'DIRECT', certId: 'x' })).toBe('a.com, 1, DIRECT, x')
  })
})

describe('validateAdsTxt — inline comments & extra fields', () => {
  it('parses records with trailing # comments and keeps the comment', () => {
    const r = validateAdsTxt(OWNER + 'google.com, pub-1, DIRECT # main account')
    expect(r.stats.errors).toBe(0)
    expect(r.records[0].relationship).toBe('DIRECT')
    expect(r.cleanedContent.split('\n')[1]).toBe('google.com, pub-1, DIRECT, f08c47fec0942fa0 # main account')
  })

  it('parses variables with trailing # comments', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com # owner\nfoo.com, 1, DIRECT')
    expect(r.variables.OWNERDOMAIN).toBe('a.com')
    expect(r.cleanedContent.split('\n')[0]).toBe('OWNERDOMAIN=a.com # owner')
    expect(r.outputLineStatuses[0]).toBeNull()
  })

  it('warns about and drops fields beyond the 4th', () => {
    const r = validateAdsTxt(OWNER + 'foo.com, 1, DIRECT, 0123456789abcdef, extra')
    expect(r.issues.some(i => /Extra fields removed: 'extra'/.test(i.message))).toBe(true)
    expect(r.cleanedContent.split('\n')[1]).toBe('foo.com, 1, DIRECT, 0123456789abcdef')
  })
})

describe('validateAdsTxt — line endings', () => {
  it('normalizes CRLF and CR line endings to LF', () => {
    const r = validateAdsTxt('# hdr\r\nOWNERDOMAIN=a.com\r\nfoo.com, 1\rbar.com, 2, DIRECT\r\n')
    expect(r.cleanedContent).not.toMatch(/\r/)
    expect(r.cleanedContent.split('\n')).toHaveLength(5)
    expect(r.inputLineIssues.get(3)).toBe('error')
  })
})

describe('validateAdsTxt — record domain cleanup', () => {
  it('strips scheme and path from record domains and marks the line corrected', () => {
    const r = validateAdsTxt(OWNER + 'https://Foo.com/, 1, DIRECT')
    expect(r.records[0].domain).toBe('foo.com')
    expect(r.stats.errors).toBe(0)
    expect(r.outputLineStatuses[1]).toBe('corrected')
    expect(r.cleanedContent.split('\n')[1]).toBe('foo.com, 1, DIRECT')
  })
})
