/**
 * Tiny in-process TTL cache.
 *
 * The browser polls every 30s, but the upstream sources are slow, rate-limited
 * and in some cases metered per request. Without a server-side cache, N open
 * dashboards would mean N × (House ZIP download + Senate handshake + report
 * fetches) every 30 seconds — which is both a bad citizen and slow.
 *
 * So the snapshot is recomputed on a longer interval than the poll rate, and
 * pollers are served the cached copy. A stale entry is still returned while a
 * refresh is in flight, so a slow upstream never blocks a request, and a
 * single-flight promise stops concurrent requests stampeding the same fetch.
 *
 * This lives in process memory: it is per-instance, and resets on restart. Wire
 * up Redis (or similar) if running multiple instances behind a load balancer.
 */

interface Entry<T> {
  value: T;
  storedAt: number;
  /** In-flight refresh, shared so concurrent callers don't duplicate work. */
  inflight?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();

export interface CachedOptions {
  /** How long a value is considered fresh. */
  ttlMs: number;
  /**
   * How long a stale value may still be served while a refresh runs in the
   * background. Defaults to 10× the TTL.
   */
  staleWhileRevalidateMs?: number;
}

export async function cached<T>(
  key: string,
  loader: () => Promise<T>,
  { ttlMs, staleWhileRevalidateMs }: CachedOptions,
): Promise<T> {
  const swr = staleWhileRevalidateMs ?? ttlMs * 10;
  const entry = store.get(key) as Entry<T> | undefined;
  const now = Date.now();

  if (entry) {
    const age = now - entry.storedAt;
    if (age < ttlMs) return entry.value;

    // Stale but usable: kick off a refresh and serve the existing value.
    if (age < swr) {
      if (!entry.inflight) {
        entry.inflight = loader()
          .then((value) => {
            store.set(key, { value, storedAt: Date.now() });
            return value;
          })
          .catch(() => {
            // Keep serving the stale value; clear the latch so the next request
            // can retry rather than being stuck behind a failed refresh.
            entry.inflight = undefined;
            return entry.value;
          });
      }
      return entry.value;
    }
  }

  // No value, or too stale to serve: single-flight the load.
  if (entry?.inflight) return entry.inflight;

  const inflight = loader().then((value) => {
    store.set(key, { value, storedAt: Date.now() });
    return value;
  });

  store.set(key, {
    value: entry?.value as T,
    storedAt: entry?.storedAt ?? 0,
    inflight,
  });

  try {
    return await inflight;
  } catch (err) {
    store.delete(key);
    throw err;
  }
}

export function invalidate(key: string): void {
  store.delete(key);
}
