// Share links carry the whole file base64-encoded in the URL hash.
export const MAX_SHARE_LENGTH = 100000  // ~75 KB of source text; longer URLs break in many clients

export function encodeShare(str) {
  try {
    const bytes = new TextEncoder().encode(str)
    const binStr = Array.from(bytes, b => String.fromCodePoint(b)).join('')
    return btoa(binStr)
  } catch { return null }
}

export function decodeShare(b64) {
  try {
    const binStr = atob(b64)
    const bytes = Uint8Array.from(binStr, c => c.codePointAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return null }
}

// Returns { url } or { error: 'empty' | 'encode' | 'too-large' }.
export function buildShareUrl(content, baseUrl) {
  if (!content.trim()) return { error: 'empty' }
  const encoded = encodeShare(content)
  if (!encoded) return { error: 'encode' }
  if (encoded.length > MAX_SHARE_LENGTH) return { error: 'too-large' }
  return { url: `${baseUrl}#${encoded}` }
}

// navigator.clipboard is unavailable on insecure origins and can reject when the
// document isn't focused — fall back to execCommand so copy buttons don't throw.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // The whole fallback (creation through execCommand) stays inside one
    // try/catch/finally: callers (App.jsx's copy/share buttons) await this
    // with no try/catch of their own and expect `false`, never a rejection,
    // on any failure — not just an execCommand failure, but also a setup
    // step throwing (e.g. appendChild rejected by a restrictive sandbox).
    // `finally` guarantees the invisible textarea is removed either way;
    // without it, a throw skipped the removal and left it in the DOM
    // permanently (execCommand itself is deprecated and increasingly
    // disabled/restricted by browsers, so this is a real path, not just
    // theoretical).
    let ta
    try {
      ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      ta?.remove()
    }
  }
}
