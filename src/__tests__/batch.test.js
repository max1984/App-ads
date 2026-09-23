import { describe, it, expect } from 'vitest'
import { batchResultsToCsv } from '../batch.js'
import { validateAdsTxt } from '../validator.js'

describe('batchResultsToCsv', () => {
  it('writes a header and one row per result', () => {
    const csv = batchResultsToCsv([
      { url: 'https://a.com/app-ads.txt', status: 'done', result: validateAdsTxt('OWNERDOMAIN=a.com\nfoo.com, 1, DIRECT'), error: null },
      { url: 'https://b.com/app-ads.txt', status: 'error', result: null, error: 'file not found (HTTP 404)' },
    ])
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe('url,status,score,grade,records,direct,reseller,errors,warnings,duplicates,ownerdomain,error')
    expect(lines[1]).toBe('https://a.com/app-ads.txt,done,100,A,1,1,0,0,0,0,a.com,')
    expect(lines[2]).toBe('https://b.com/app-ads.txt,error,,,,,,,,,,file not found (HTTP 404)')
  })

  it('quotes commas/quotes and neutralizes formula-like cells', () => {
    const csv = batchResultsToCsv([{ url: '=HYPERLINK("x")', status: 'error', result: null, error: 'a, "b"' }])
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")",error,,,,,,,,,,"a, ""b"""`)
  })
})
