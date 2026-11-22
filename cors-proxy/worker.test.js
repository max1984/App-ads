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

  it('rejects any method other than GET/OPTIONS', async () => {
    const res = await worker.fetch(req('https://proxy.example/?url=https://good.com/app-ads.txt', 'POST'))
    expect(res.status).toBe(405)
  })

  it('answers an OPTIONS preflight with CORS headers and no body', async () => {
    const res = await worker.fetch(req('https://proxy.example/', 'OPTIONS'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.text()).toBe('')
  })

  it('rejects a request with no url param at all', async () => {
    const res = await worker.fetch(req('https://proxy.example/'))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Missing url param')
  })

  it('rejects a target param that is not a parseable URL', async () => {
    const res = await worker.fetch(req('https://proxy.example/?url=not-a-url'))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Invalid url')
  })

  it('reports a 502 when the upstream fetch itself throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const res = await worker.fetch(req('https://proxy.example/?url=https://good.com/app-ads.txt'))
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Upstream fetch failed: fetch failed')
  })

  it('rejects a redirect whose Location header is not a parseable URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://' } })
      )
    )
    const res = await worker.fetch(req('https://proxy.example/?url=https://good.com/app-ads.txt'))
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Invalid redirect location')
  })

  it('rejects an upstream response whose declared Content-Length exceeds the size cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('irrelevant', { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } })
      )
    )
    const res = await worker.fetch(req('https://proxy.example/?url=https://good.com/app-ads.txt'))
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Upstream response too large')
  })

  it('rejects an oversized body even when Content-Length is absent or understated (regression)', async () => {
    // Without this second, real-size check, a missing/lying Content-Length header would let
    // an oversized response through the cap the header-based check above exists to enforce.
    const big = 'x'.repeat(6 * 1024 * 1024)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(big, { status: 200 })))
    const res = await worker.fetch(req('https://proxy.example/?url=https://good.com/app-ads.txt'))
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('Upstream response too large')
  })
})
