const cache = new Map();

/** Small in-process TTL cache. Keeps us well under every upstream rate limit. */
export function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;

  const promise = producer().catch((err) => {
    cache.delete(key); // never cache a failure
    throw err;
  });
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  return promise;
}

export class UpstreamError extends Error {
  constructor(message, status = 502, detail, upstreamStatus) {
    super(message);
    this.status = status; // what we return to the browser
    this.detail = detail;
    // What the upstream actually said. We don't pass every upstream status
    // through verbatim, but providers need it to recognise "not found" vs
    // "bad key" and swap in a message that tells the user what to do.
    this.upstreamStatus = upstreamStatus ?? status;
  }
}

/** fetch + JSON + timeout + a readable error when the upstream misbehaves. */
export async function getJSON(url, options = {}) {
  const { timeoutMs = 12000, label = 'upstream', ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VaultCheck/1.0 (personal account viewer)',
        ...init.headers,
      },
    });
  } catch (err) {
    throw new UpstreamError(
      err.name === 'AbortError'
        ? `${label} timed out`
        : `Could not reach ${label}`,
      504
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new UpstreamError(
      `${label} returned ${res.status}`,
      res.status === 429 ? 429 : 502,
      body ?? text.slice(0, 300),
      res.status
    );
  }
  return body;
}
