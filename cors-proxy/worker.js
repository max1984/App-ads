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
const MAX_REDIRECTS = 5

function isAllowedAppAdsUrl(url) {
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    /\/app-ads\.txt$/i.test(url.pathname)
  )
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
    }

    const target = new URL(request.url).searchParams.get('url')
    if (!target) return new Response('Missing url param', { status: 400, headers: CORS_HEADERS })

    let currentUrl
    try {
      currentUrl = new URL(target)
    } catch {
      return new Response('Invalid url', { status: 400, headers: CORS_HEADERS })
    }
    if (!isAllowedAppAdsUrl(currentUrl)) {
      return new Response('Only http/https app-ads.txt paths allowed', { status: 400, headers: CORS_HEADERS })
    }

    // Redirects are followed manually (not via `redirect: 'follow'`) so each hop can be
    // re-validated against the same allowlist — otherwise an upstream could redirect this
    // proxy to an arbitrary, unscoped URL and it would fetch and return it, defeating the
    // path restriction above and turning this into a generic open proxy.
    let upstream
    for (let hop = 0; ; hop++) {
      try {
        upstream = await fetch(currentUrl.toString(), {
          redirect: 'manual',
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'app-ads-validator-proxy/1.0' },
        })
      } catch (err) {
        return new Response(`Upstream fetch failed: ${err.message}`, { status: 502, headers: CORS_HEADERS })
      }

      const location = upstream.headers.get('location')
      const isRedirect = upstream.status >= 300 && upstream.status < 400 && location
      if (!isRedirect) break

      if (hop >= MAX_REDIRECTS) {
        return new Response('Too many redirects', { status: 502, headers: CORS_HEADERS })
      }
      let nextUrl
      try {
        nextUrl = new URL(location, currentUrl)
      } catch {
        return new Response('Invalid redirect location', { status: 502, headers: CORS_HEADERS })
      }
      if (!isAllowedAppAdsUrl(nextUrl)) {
        return new Response('Redirect target not allowed', { status: 502, headers: CORS_HEADERS })
      }
      currentUrl = nextUrl
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
