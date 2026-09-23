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

  it('leaves explicit paths untouched', () => {
    expect(normalizeAdsTxtUrl('https://example.com/ads.txt')).toBe('https://example.com/ads.txt')
    expect(normalizeAdsTxtUrl('example.com/custom/app-ads.txt')).toBe('https://example.com/custom/app-ads.txt')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeAdsTxtUrl('   ')).toBe('')
  })
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
