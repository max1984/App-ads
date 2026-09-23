import { describe, it, expect } from 'vitest'
import { normalizeAdsTxtUrl } from '../url.js'

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
