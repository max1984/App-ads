// Minimal CORS proxy for app-ads.txt, run on the repo owner's own Cloudflare account —
// self-hosted so "Load from URL" doesn't depend on a third-party free proxy's uptime
// (the ones tried before this, allorigins.win and corsfix.com, turned out to be
// unreliable or to require per-domain registration). Scoped to only fetch paths
// ending in /app-ads.txt so this public endpoint can't be repurposed as a generic
// open proxy for unrelated traffic.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const MAX_BODY_BYTES = 5 * 1024 * 1024

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
    }

    const target = new URL(request.url).searchParams.get('url')
    if (!target) return new Response('Missing url param', { status: 400, headers: CORS_HEADERS })

    let targetUrl
    try {
      targetUrl = new URL(target)
    } catch {
      return new Response('Invalid url', { status: 400, headers: CORS_HEADERS })
    }
    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return new Response('Only http/https allowed', { status: 400, headers: CORS_HEADERS })
    }
    if (!/\/app-ads\.txt$/i.test(targetUrl.pathname)) {
      return new Response('Only app-ads.txt paths allowed', { status: 400, headers: CORS_HEADERS })
    }

    let upstream
    try {
      upstream = await fetch(targetUrl.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'app-ads-validator-proxy/1.0' },
      })
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, { status: 502, headers: CORS_HEADERS })
    }

    const lengthHeader = upstream.headers.get('content-length')
    if (lengthHeader && Number(lengthHeader) > MAX_BODY_BYTES) {
      return new Response('Upstream response too large', { status: 502, headers: CORS_HEADERS })
    }

    const body = await upstream.arrayBuffer()
    if (body.byteLength > MAX_BODY_BYTES) {
      return new Response('Upstream response too large', { status: 502, headers: CORS_HEADERS })
    }

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstream.headers.get('content-type') || 'text/plain',
      },
    })
  },
}
