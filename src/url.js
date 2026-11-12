// Turns user input like "example.com" or "https://example.com/" into the canonical
// app-ads.txt location. Without this, a bare domain is fetched as a *relative* URL
// against the validator's own origin.
//
// The IAB spec requires app-ads.txt to live at the domain root — there is no
// such thing as a legitimate non-root location for it. This used to only
// fill in the path when it was empty/"/", leaving an explicit path (e.g.
// pasted from a browser's address bar, or hand-typed) untouched. A single
// typo'd path (e.g. "app-apds.txt") then got fetched literally: no local
// 404 (many sites answer any unknown path with a redirect to their
// homepage/PWA shell instead), just a confusing failure with no indication
// the path itself was wrong. Always forcing the canonical path removes that
// whole failure mode — whatever path was typed, root is the only place this
// file can actually be.
export function normalizeAdsTxtUrl(input) {
  let raw = (input || '').trim()
  if (!raw) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw.replace(/^\/+/, '')}`
  let url
  try { url = new URL(raw) } catch { return raw }
  url.pathname = '/app-ads.txt'
  // Only the scheme+host+path identify the file per spec — a query string or
  // hash pasted along with the rest of the URL (e.g. a Play Store listing or
  // marketing link still carrying "?utm_source=…" or "#section") has no
  // meaning for a static text file and would otherwise ride along into the
  // actual fetch, which can change what some servers return (caching/WAF
  // rules keyed on the query string) or just leave the "Loaded from:"
  // breadcrumb showing leftover query noise that has nothing to do with the
  // file.
  url.search = ''
  url.hash = ''
  return url.toString()
}

// Many hosts answer a missing /app-ads.txt with their HTML homepage and a 200 status
// (soft 404). Validating that would bury the user in hundreds of bogus errors.
export function looksLikeHtml(text) {
  return /^\s*(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(text)
}

async function fetchText(fetchImpl, url, timeoutMs) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) {
    const err = new Error(res.status === 404 ? 'file not found (HTTP 404)' : `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.text()
}

// Free public CORS proxies are individually unreliable (observed: the sole proxy this
// used to call, allorigins, intermittently times out, 500s, or omits CORS headers on an
// otherwise-200 response — roughly 4 out of 5 attempts in one spot check). Relying on a
// single one meant its outages took down "Load from URL" for every site that doesn't
// send its own CORS headers (most publishers' app-ads.txt, since it's a plain static
// file). Trying a short, ordered chain means one proxy's bad day doesn't sink the feature.
const CORS_PROXIES = [
  (url) => `https://proxy.corsfix.com/?${url}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
]

// Tries a direct fetch first, then each CORS proxy in turn (most publisher sites don't
// send CORS headers).
export async function fetchFromUrl(url, fetchImpl = fetch) {
  let text
  try {
    text = await fetchText(fetchImpl, url, 6000)
  } catch (directErr) {
    // A real HTTP status from the server is authoritative — a proxy would only repeat it.
    if (directErr.status) throw directErr
    let lastErr = directErr
    let gotText = false
    for (const buildProxyUrl of CORS_PROXIES) {
      try {
        text = await fetchText(fetchImpl, buildProxyUrl(url), 10000)
        gotText = true
        break
      } catch (proxyErr) {
        // A genuine 404 forwarded from the target is authoritative — trying the next
        // proxy wouldn't make the file exist, it would just waste another round trip.
        if (proxyErr.status === 404) throw proxyErr
        lastErr = proxyErr
      }
    }
    if (!gotText) {
      throw new Error(lastErr.name === 'TimeoutError' ? 'request timed out' : 'network error or blocked by CORS')
    }
  }
  if (looksLikeHtml(text)) {
    throw new Error('the URL returned an HTML page, not a text file — the app-ads.txt probably does not exist there')
  }
  return text
}
