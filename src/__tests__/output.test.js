import { describe, it, expect } from 'vitest'
import { sortCleanedOutput, sortRecordsForExport } from '../output.js'

describe('sortCleanedOutput', () => {
  it('keeps comments first, variables next, then sorted records', () => {
    const input = 'zeta.com, 1, DIRECT\n# header\nOWNERDOMAIN=a.com\nalpha.com, 2, RESELLER\nCONTACT=x@a.com'
    const { content } = sortCleanedOutput(input)
    expect(content.split('\n')).toEqual([
      '# header',
      'OWNERDOMAIN=a.com',
      'CONTACT=x@a.com',
      'alpha.com, 2, RESELLER',
      'zeta.com, 1, DIRECT',
    ])
  })

  it('carries line statuses along with their lines', () => {
    const { statuses } = sortCleanedOutput('b.com, 1, DIRECT\na.com, 1, DIRECT', ['error', 'corrected'])
    expect(statuses).toEqual(['corrected', 'error'])
  })

  it('breaks ties between two same-domain lines the same way JSON export must', () => {
    // Two records for the same domain: sortCleanedOutput (used for the
    // .txt download/output panel) sorts by the full line text, so ties on
    // domain are broken by whatever comes next (here, publisher ID).
    const { content } = sortCleanedOutput('google.com, pub-2, DIRECT\ngoogle.com, pub-1, DIRECT')
    expect(content.split('\n')).toEqual(['google.com, pub-1, DIRECT', 'google.com, pub-2, DIRECT'])
  })

  // Regression: validator.js keeps a malformed data line (too few fields) verbatim —
  // including any leading whitespace — so the user can see and fix it. Sorting by the
  // raw (untrimmed) line text put that whitespace before every real domain character,
  // jumping the broken line to the top of the list regardless of its actual content.
  it('sorts a malformed line with leading whitespace by its trimmed content', () => {
    const { content } = sortCleanedOutput('zebra.com, 1, DIRECT\n  bad-line\napple.com, 2, DIRECT')
    expect(content.split('\n')).toEqual(['apple.com, 2, DIRECT', '  bad-line', 'zebra.com, 1, DIRECT'])
  })
})

describe('sortRecordsForExport', () => {
  // Regression: records were previously sorted by domain alone, so two
  // same-domain records kept whatever order they happened to have in the
  // original file — disagreeing with sortCleanedOutput's full-line sort
  // (the test above) whenever that original order put the alphabetically
  // later publisher ID first, exactly like this case.
  it('matches sortCleanedOutput\'s tie-break order for same-domain records', () => {
    const records = [
      { domain: 'google.com', publisherId: 'pub-2', relationship: 'DIRECT', certId: '' },
      { domain: 'google.com', publisherId: 'pub-1', relationship: 'DIRECT', certId: '' },
    ]
    const sorted = sortRecordsForExport(records)
    expect(sorted.map(r => r.publisherId)).toEqual(['pub-1', 'pub-2'])
  })

  it('does not mutate the input array', () => {
    const records = [{ domain: 'b.com', publisherId: '1', relationship: 'DIRECT', certId: '' }]
    const original = [...records]
    sortRecordsForExport(records)
    expect(records).toEqual(original)
  })

  // Regression: validator.js's dedup key (recordKey) does not include
  // extensionData, so two records sharing domain+publisherId+relationship+
  // certId but with different trailing `;`-extension data both survive as
  // distinct records. Without comparing `extensions` too, this tie fell
  // back to original file order — disagreeing with sortCleanedOutput's
  // full-line sort whenever that order put the alphabetically later
  // extension first, exactly like this case.
  it('breaks ties on identical domain/publisherId/relationship/certId by extensions', () => {
    const records = [
      { domain: 'google.com', publisherId: 'pub-1', relationship: 'DIRECT', certId: 'abc', extensions: ';tag=2' },
      { domain: 'google.com', publisherId: 'pub-1', relationship: 'DIRECT', certId: 'abc', extensions: ';tag=1' },
    ]
    const sorted = sortRecordsForExport(records)
    expect(sorted.map(r => r.extensions)).toEqual([';tag=1', ';tag=2'])
  })
})
