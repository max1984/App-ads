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
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch { return false }
  }
}
