const PRINT_TIMEOUT_MS = 15_000

function normalizeHost(host: string) {
  return host.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

/**
 * Send raw ZPL to a Zebra printer over HTTP (Link-OS /pstprnt).
 * Browser cannot open raw TCP 9100; /pstprnt is the LAN path from the web app.
 */
export async function printByNetwork(host: string, zpl: string): Promise<void> {
  const clean = normalizeHost(host)
  if (!clean) {
    throw new Error('Printer host is required')
  }
  if (!zpl.trim()) {
    throw new Error('ZPL is empty')
  }

  const url = `http://${clean}/pstprnt`
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PRINT_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: zpl,
      signal: controller.signal,
      mode: 'no-cors',
    })
    // no-cors → opaque response; treat as sent if no network throw
    void res
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Printer request timed out')
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      message.includes('Failed to fetch')
        ? 'Cannot reach printer (check IP, LAN, or CORS)'
        : message,
    )
  } finally {
    window.clearTimeout(timer)
  }
}
