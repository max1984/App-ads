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
})
