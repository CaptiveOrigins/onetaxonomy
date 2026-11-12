/** A request that didn't succeed, with words a person can read. `status` is 0 when the site wasn't reached. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Sign in again to do this.',
  403: 'You aren\'t allowed to do this.',
  404: 'This wasn\'t found, or you may not see it.',
}

/** The reason in an error answer: the plugin's `{ error }`, or Payload's `{ errors: [{ message }] }`. */
export function reasonIn(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { error?: unknown; errors?: unknown; message?: unknown }
  if (typeof b.error === 'string' && b.error) return b.error
  if (Array.isArray(b.errors)) {
    const all = b.errors.map((e) => (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : '')).filter(Boolean)
    if (all.length) return all.join(' ')
  }
  return typeof b.message === 'string' && b.message ? b.message : null
}

/**
 * One JSON request to the site's own API, with the signed-in person's cookie. Anything but a 2xx answer throws a
 * `RequestError` carrying the site's own reason when it gave one.
 */
export async function request<T>(url: string, init: { method?: 'GET' | 'PATCH' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    })
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error
    throw new RequestError('The site couldn\'t be reached. Check your connection and try again.', 0)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) throw new RequestError(reasonIn(body) ?? FALLBACK[res.status] ?? `The request failed (${res.status}).`, res.status)
  return body as T
}

/** Words for a thrown value. */
export const reasonOf = (error: unknown): string => (error instanceof Error && error.message ? error.message : 'Something went wrong, and nothing more is known.')
