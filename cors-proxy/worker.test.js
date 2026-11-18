import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from './worker.js'

function req(url, method = 'GET') {
  return new Request(url, { method })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cors-proxy worker', () => {
  it('rejects a target whose own path does not end in app-ads.txt', async () => {
    const res = await worker.fetch(req('https://proxy.example/?url=https://evil.com/admin'))
    expect(res.status).toBe(400)
  })

  it('proxies a plain app-ads.txt response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('example.com, 123, DIRECT', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      )
    )
    const res = await worker.fetch(req('https://proxy.example/?url=https://good.com/app-ads.txt'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('example.com, 123, DIRECT')
  })

  it('follows a redirect that stays within an allowed app-ads.txt path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: 'https://good.com/app-ads.txt' } })
      )
      .mockResolvedValueOnce(new Response('ok-after-redirect', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await worker.fetch(
      req('https://proxy.example/?url=https://good.com/old-path/app-ads.txt')
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok-after-redirect')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects when upstream redirects outside the allowed app-ads.txt scope (regression)', async () => {
    // Without re-validating each redirect hop, this would follow the upstream anywhere —
    // defeating the "only /app-ads.txt paths" restriction the worker advertises.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://internal.example/secret' } })
      )
    )
    const res = await worker.fetch(
      req('https://proxy.example/?url=https://good.com/app-ads.txt')
    )
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Redirect target not allowed')
  })

  it('gives up after too many redirect hops instead of looping forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://good.com/app-ads.txt' } })
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await worker.fetch(req('https://proxy.example/?url=https://good.com/app-ads.txt'))
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Too many redirects')
  })
})
