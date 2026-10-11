// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { encodeShare, decodeShare, buildShareUrl, MAX_SHARE_LENGTH, copyText } from '../share.js'

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

describe('copyText', () => {
  afterEach(() => {
    document.querySelectorAll('textarea').forEach(ta => ta.remove())
    delete document.execCommand
    vi.restoreAllMocks()
  })

  it('removes the fallback textarea even when execCommand throws', async () => {
    // navigator.clipboard is unavailable on insecure origins (and in many
    // sandboxed/test environments) — this is exactly what sends copyText
    // into the execCommand fallback path in the first place. jsdom doesn't
    // implement execCommand at all, so it's assigned directly rather than
    // spied on.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('no clipboard')) },
      configurable: true,
    })
    document.execCommand = () => {
      throw new Error('copy disabled by this browser/sandbox')
    }

    const ok = await copyText('hello')

    expect(ok).toBe(false)
    expect(document.querySelectorAll('textarea').length).toBe(0)
  })

  it('removes the fallback textarea when execCommand returns false', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('no clipboard')) },
      configurable: true,
    })
    document.execCommand = () => false

    const ok = await copyText('hello')

    expect(ok).toBe(false)
    expect(document.querySelectorAll('textarea').length).toBe(0)
  })

  it('resolves to false (never rejects) if a fallback setup step throws', async () => {
    // App.jsx's copy/share button handlers await copyText with no try/catch
    // of their own and only ever branch on a falsy return — a rejected
    // promise here would be an unhandled rejection in a click handler, not
    // the graceful "copy failed" UI state the rest of the function assumes.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('no clipboard')) },
      configurable: true,
    })
    document.execCommand = () => true
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
      throw new Error('appendChild blocked by a restrictive sandbox')
    })

    await expect(copyText('hello')).resolves.toBe(false)
  })
})
