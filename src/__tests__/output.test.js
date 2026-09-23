import { describe, it, expect } from 'vitest'
import { sortCleanedOutput } from '../output.js'

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
})
