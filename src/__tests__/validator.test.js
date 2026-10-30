import { describe, it, expect } from 'vitest'
import { validateAdsTxt, compareSnapshots, formatRecordLine, computeHealthScore, DOMAIN_TO_CERT } from '../validator.js'

const OWNER = 'OWNERDOMAIN=example.com\n'

describe('validateAdsTxt — records', () => {
  it('normalizes domain and relationship case, preserves publisher ID case', () => {
    const r = validateAdsTxt(OWNER + 'Example.COM, PUB-ABC, direct')
    expect(r.cleanedContent.split('\n')[1]).toBe('example.com, PUB-ABC, DIRECT')
    expect(r.outputLineStatuses[1]).toBe('corrected')
    expect(r.changes).toHaveLength(1)
  })

  it('does not list an error line as "corrected" just because it also needed case normalization', () => {
    // Domain casing needs cleanup (Example.COM -> example.com) AND the relationship is
    // invalid (BOGUS) — the line must surface only as an error, not also appear in the
    // "normalized" Changes pill as if it were a benign auto-fix.
    const r = validateAdsTxt(OWNER + 'Example.COM, pub-1, BOGUS')
    expect(r.outputLineStatuses[1]).toBe('error')
    expect(r.changes).toHaveLength(0)
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

  it('suggests RESELLER (not DIRECT) for a relationship typo of "indirect"', () => {
    // 'indirect' contains 'direct' as a substring — a naive check would guess the
    // opposite of what the word means, since an indirect relationship is exactly
    // what RESELLER represents.
    const r = validateAdsTxt(OWNER + 'foo.com, 1, indirect')
    const err = r.issues.find(i => i.severity === 'error')
    expect(err.suggestion).toMatch(/RESELLER/)
    expect(err.suggestion).not.toMatch(/,\s*DIRECT/)
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

  it(
    'regression: a line with an error (invalid relationship) was still counted as ' +
      '"present" in Network Coverage just because its domain matched — an ad network ' +
      'would never honor a broken line, so it must show as missing, not a false ✓',
    () => {
      const r = validateAdsTxt(OWNER + 'google.com, pub-1, directt')
      expect(r.stats.errors).toBeGreaterThan(0)
      expect(r.coverage.present.map(n => n.domain)).not.toContain('google.com')
      expect(r.coverage.missing.map(n => n.domain)).toContain('google.com')
    }
  )
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

describe('validateAdsTxt — publisher ID whitespace & duplicate variables', () => {
  it('warns when publisher ID contains whitespace', () => {
    const r = validateAdsTxt(OWNER + 'foo.com, pub 123, DIRECT')
    const w = r.issues.find(i => /contains whitespace/.test(i.message))
    expect(w.severity).toBe('warning')
    expect(w.suggestion).toMatch(/'pub123'/)
  })

  it('removes exact duplicate variable lines without a multiple-OWNERDOMAIN warning', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com\nownerdomain=A.com\nfoo.com, 1, DIRECT')
    expect(r.stats.duplicatesRemoved).toBe(1)
    expect(r.issues.some(i => /Multiple OWNERDOMAIN/.test(i.message))).toBe(false)
    expect(r.cleanedContent.split('\n')).toEqual(['OWNERDOMAIN=a.com', 'foo.com, 1, DIRECT'])
  })

  it('keeps repeated variables with different values', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com\nCONTACT=a@a.com\nCONTACT=b@b.com\nfoo.com, 1, DIRECT')
    expect(r.stats.duplicatesRemoved).toBe(0)
  })
})

describe('computeHealthScore', () => {
  it('returns null when there are no records', () => {
    expect(computeHealthScore(validateAdsTxt('OWNERDOMAIN=a.com').stats)).toBeNull()
  })

  it('gives a clean file 100 / A', () => {
    expect(computeHealthScore(validateAdsTxt(OWNER + 'foo.com, 1, DIRECT').stats)).toEqual({ score: 100, grade: 'A' })
  })

  it('penalizes errors, warnings and duplicates with caps', () => {
    expect(computeHealthScore({ totalRecords: 5, errors: 1, warnings: 1, duplicatesRemoved: 1 })).toEqual({ score: 85, grade: 'B' })
    expect(computeHealthScore({ totalRecords: 50, errors: 20, warnings: 20, duplicatesRemoved: 20 })).toEqual({ score: 0, grade: 'F' })
  })
})

describe('validateAdsTxt — cert ID mismatch', () => {
  it('warns when a known domain uses another network\'s cert, with an applicable fix', () => {
    const r = validateAdsTxt(OWNER + 'google.com, pub-1, DIRECT, c3e20eee3f780d68')
    const w = r.issues.find(i => /belongs to Meta/.test(i.message))
    expect(w.severity).toBe('warning')
    expect(w.suggestion).toBe('Change to: google.com, pub-1, DIRECT, f08c47fec0942fa0')
  })

  it(
    'still warns when the mismatched cert belongs to an unrelated company whose name happens to ' +
      'start with the same generic word ("The") as the expected one — companyOf() used to compare ' +
      'only the first word, so "The Media Grid" and "The Brave" looked like the same company and ' +
      'this genuine mismatch went completely undetected',
    () => {
      const r = validateAdsTxt(OWNER + 'themediagrid.com, pub-1, DIRECT, c25b2154543746ac')
      const w = r.issues.find(i => /belongs to The Brave/.test(i.message))
      expect(w.severity).toBe('warning')
      expect(w.suggestion).toBe('Change to: themediagrid.com, pub-1, DIRECT, 35d5010d7789b49d')
    }
  )

  it('accepts alternate certs of the same company', () => {
    const r = validateAdsTxt(OWNER + 'criteo.com, 1, DIRECT, 3fd707be9c4527c3')
    expect(r.stats.warnings).toBe(0)
  })

  it('does not warn for the expected cert', () => {
    const r = validateAdsTxt(OWNER + 'google.com, pub-1, DIRECT, f08c47fec0942fa0')
    expect(r.stats.warnings).toBe(0)
  })
})

describe('validateAdsTxt — cert ID mismatch (same company)', () => {
  it('does not warn when the cert belongs to another product of the same company', () => {
    const r = validateAdsTxt(OWNER + 'google.com, pub-1, DIRECT, 7842df1d2fe2db34')
    expect(r.stats.warnings).toBe(0)
  })

  it(
    'does not warn for yahoo.com\'s alternate Verizon Media / Oath cert — same company across ' +
      "its rebrand history as the cert yahoo.com normally uses, so it was wrongly labeled " +
      '"Verizon Media / Oath" instead of starting with "Yahoo", tripping the different-company check',
    () => {
      const r = validateAdsTxt(OWNER + 'yahoo.com, pub-1, DIRECT, e1a5b5b704a45b4e')
      expect(r.stats.warnings).toBe(0)
    }
  )
})

describe('validateAdsTxt — MANAGERDOMAIN country code', () => {
  it('accepts and normalizes domain,country', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com\nMANAGERDOMAIN=Manager.com, us\nfoo.com, 1, DIRECT')
    expect(r.stats.errors).toBe(0)
    expect(r.cleanedContent.split('\n')[1]).toBe('MANAGERDOMAIN=manager.com,US')
    expect(r.variables.MANAGERDOMAIN).toBe('manager.com,US')
  })

  it('errors on an invalid country code', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com\nMANAGERDOMAIN=manager.com,USA\nfoo.com, 1, DIRECT')
    expect(r.issues.some(i => /not a 2-letter ISO country code/.test(i.message))).toBe(true)
  })

  it('still accepts a bare MANAGERDOMAIN', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com\nMANAGERDOMAIN=manager.com\nfoo.com, 1, DIRECT')
    expect(r.stats.errors).toBe(0)
  })

  it('warns on two conflicting global MANAGERDOMAIN declarations', () => {
    const r = validateAdsTxt('OWNERDOMAIN=a.com\nMANAGERDOMAIN=one.com\nMANAGERDOMAIN=two.com\nfoo.com, 1, DIRECT')
    expect(r.issues.some(i => /Multiple global MANAGERDOMAIN/.test(i.message))).toBe(true)
  })

  it('warns on two conflicting MANAGERDOMAIN declarations for the same country', () => {
    const r = validateAdsTxt(
      'OWNERDOMAIN=a.com\nMANAGERDOMAIN=one.com,US\nMANAGERDOMAIN=two.com,US\nfoo.com, 1, DIRECT')
    expect(r.issues.some(i => /Multiple MANAGERDOMAIN declarations for country 'US'/.test(i.message))).toBe(true)
  })

  it('does not warn for MANAGERDOMAIN declarations covering different countries', () => {
    const r = validateAdsTxt(
      'OWNERDOMAIN=a.com\nMANAGERDOMAIN=global.com\nMANAGERDOMAIN=us.com,US\nMANAGERDOMAIN=de.com,DE\nfoo.com, 1, DIRECT')
    expect(r.issues.some(i => /Multiple.*MANAGERDOMAIN/.test(i.message))).toBe(false)
  })

  it('does not warn when the same MANAGERDOMAIN,country is repeated identically', () => {
    const r = validateAdsTxt(
      'OWNERDOMAIN=a.com\nMANAGERDOMAIN=manager.com,US\nMANAGERDOMAIN=manager.com,US\nfoo.com, 1, DIRECT')
    expect(r.issues.some(i => /Multiple.*MANAGERDOMAIN/.test(i.message))).toBe(false)
  })
})

describe('validateAdsTxt — DOMAIN_TO_CERT / VALID_CA_IDS drift tolerance', () => {
  it(
    'does not crash the whole validation when DOMAIN_TO_CERT maps a domain to a cert ID ' +
      "that isn't itself a VALID_CA_IDS key — the company-name comparison used to call " +
      'companyOf(undefined) in that case and throw, instead of just degrading one message',
    () => {
      // These two hand-maintained tables are in sync today (nothing enforces that at
      // runtime), so this simulates the drift a future edit to either could introduce:
      // a domain whose "known" cert isn't itself a real, looked-up-able cert ID.
      DOMAIN_TO_CERT['drift-test.example'] = 'not-a-real-cert-id'
      try {
        // google.com's real cert (f08c47fec0942fa0) is a VALID_CA_IDS key, differs from
        // the fake knownCert above, and belongs to a different company — exactly what
        // triggers the company-name comparison branch in validator.js.
        expect(() =>
          validateAdsTxt('OWNERDOMAIN=a.com\ndrift-test.example, pub-1, DIRECT, f08c47fec0942fa0')
        ).not.toThrow()
      } finally {
        delete DOMAIN_TO_CERT['drift-test.example']
      }
    }
  )
})
