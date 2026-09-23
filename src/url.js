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
