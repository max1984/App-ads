import { describe, it, expect, vi } from 'vitest'
import { normalizeAdsTxtUrl, fetchFromUrl, looksLikeHtml } from '../url.js'

describe('normalizeAdsTxtUrl', () => {
  it('expands a bare domain to https + /app-ads.txt', () => {
    expect(normalizeAdsTxtUrl('example.com')).toBe('https://example.com/app-ads.txt')
    expect(normalizeAdsTxtUrl('  Example.com/  ')).toBe('https://example.com/app-ads.txt')
  })

  it('appends /app-ads.txt to a root URL', () => {
    expect(normalizeAdsTxtUrl('http://example.com')).toBe('http://example.com/app-ads.txt')
  })

  it(
    'forces any explicit path to the canonical /app-ads.txt — the IAB spec requires it at ' +
      'the domain root, so there is no legitimate reason to fetch a different path, and a ' +
      "typo'd one (e.g. pasted from elsewhere) used to fail confusingly instead of just " +
      'being corrected',
    () => {
      expect(normalizeAdsTxtUrl('https://example.com/ads.txt')).toBe('https://example.com/app-ads.txt')
      expect(normalizeAdsTxtUrl('example.com/custom/app-ads.txt')).toBe('https://example.com/app-ads.txt')
      expect(normalizeAdsTxtUrl('example.com/app-apds.txt')).toBe('https://example.com/app-ads.txt')
    }
  )

  it('returns empty string for empty input', () => {
    expect(normalizeAdsTxtUrl('   ')).toBe('')
  })

  it(
    'strips a query string and hash fragment carried over from the pasted URL — they have no ' +
      'meaning for a static file at the domain root and would otherwise ride into the actual ' +
      'fetch (and into the "Loaded from:" breadcrumb) unchanged',
    () => {
      expect(normalizeAdsTxtUrl('https://example.com/page?utm_source=x&ref=y')).toBe('https://example.com/app-ads.txt')
      expect(normalizeAdsTxtUrl('https://example.com/page#section')).toBe('https://example.com/app-ads.txt')
      expect(normalizeAdsTxtUrl('example.com?foo=bar#frag')).toBe('https://example.com/app-ads.txt')
    }
  )
})

const response = (status, body = '') => ({ ok: status >= 200 && status < 300, status, text: async () => body })

describe('looksLikeHtml', () => {
  it('detects HTML documents but not ads.txt content', () => {
    expect(looksLikeHtml('\n<!DOCTYPE html><html>')).toBe(true)
    expect(looksLikeHtml('<html lang="en">')).toBe(true)
    expect(looksLikeHtml('google.com, pub-1, DIRECT')).toBe(false)
  })
})

describe('fetchFromUrl', () => {
  it('returns text from a direct fetch', async () => {
    const f = vi.fn().mockResolvedValue(response(200, 'a.com, 1, DIRECT'))
    await expect(fetchFromUrl('https://x.com/app-ads.txt', f)).resolves.toBe('a.com, 1, DIRECT')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('falls back to the proxy when the direct fetch fails at network level', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(200, 'a.com, 1, DIRECT'))
    await expect(fetchFromUrl('https://x.com/app-ads.txt', f)).resolves.toBe('a.com, 1, DIRECT')
    expect(f.mock.calls[1][0]).toMatch(/allorigins/)
  })

  it('reports a 404 without hitting the proxy', async () => {
    const f = vi.fn().mockResolvedValue(response(404))
    await expect(fetchFromUrl('https://x.com/app-ads.txt', f)).rejects.toThrow('file not found (HTTP 404)')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('rejects HTML soft-404 pages', async () => {
    const f = vi.fn().mockResolvedValue(response(200, '<!doctype html><html></html>'))
    await expect(fetchFromUrl('https://x.com/app-ads.txt', f)).rejects.toThrow(/HTML page/)
  })

  it('gives a readable message when both attempts fail at network level', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchFromUrl('https://x.com/app-ads.txt', f)).rejects.toThrow('network error or blocked by CORS')
  })
})
