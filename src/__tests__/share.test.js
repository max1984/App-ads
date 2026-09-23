import { describe, it, expect } from 'vitest'
import { encodeShare, decodeShare, buildShareUrl, MAX_SHARE_LENGTH } from '../share.js'

describe('share encoding', () => {
  it('round-trips unicode content', () => {
    const text = 'OWNERDOMAIN=zażółć.pl\n# komentarz — ✓\ngoogle.com, pub-1, DIRECT'
    expect(decodeShare(encodeShare(text))).toBe(text)
  })

  it('returns null for invalid base64 / invalid utf-8', () => {
    expect(decodeShare('%%%')).toBeNull()
    expect(decodeShare(btoa('\xff\xfe'))).toBeNull()
  })
})

describe('buildShareUrl', () => {
  it('builds a hash URL', () => {
    const { url } = buildShareUrl('a.com, 1, DIRECT', 'https://x.io/app/')
    expect(url.startsWith('https://x.io/app/#')).toBe(true)
    expect(decodeShare(url.split('#')[1])).toBe('a.com, 1, DIRECT')
  })

  it('rejects empty and oversized content', () => {
    expect(buildShareUrl('   ', 'b').error).toBe('empty')
    expect(buildShareUrl('x'.repeat(MAX_SHARE_LENGTH), 'b').error).toBe('too-large')
  })
})
