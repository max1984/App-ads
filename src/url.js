// Turns user input like "example.com" or "https://example.com/" into the canonical
// app-ads.txt location. Without this, a bare domain is fetched as a *relative* URL
// against the validator's own origin.
export function normalizeAdsTxtUrl(input) {
  let raw = (input || '').trim()
  if (!raw) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw.replace(/^\/+/, '')}`
  let url
  try { url = new URL(raw) } catch { return raw }
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/app-ads.txt'
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

// Tries a direct fetch first, then a CORS proxy (most publisher sites don't send CORS headers).
export async function fetchFromUrl(url, fetchImpl = fetch) {
  let text
  try {
    text = await fetchText(fetchImpl, url, 6000)
  } catch (directErr) {
    // A real HTTP status from the server is authoritative — the proxy would only repeat it.
    if (directErr.status) throw directErr
    try {
      text = await fetchText(fetchImpl, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, 10000)
    } catch (proxyErr) {
      if (proxyErr.status) throw proxyErr
      throw new Error(proxyErr.name === 'TimeoutError' ? 'request timed out' : 'network error or blocked by CORS')
    }
  }
  if (looksLikeHtml(text)) {
    throw new Error('the URL returned an HTML page, not a text file — the app-ads.txt probably does not exist there')
  }
  return text
}
