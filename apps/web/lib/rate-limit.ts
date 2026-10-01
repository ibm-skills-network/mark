export interface RateLimiterOptions {
  /** How far back a request still counts against the caller. */
  windowMs: number;
  /** Requests a single caller may make inside the window. */
  maxRequests: number;
  /** Hard ceiling on how many callers are tracked at once. */
  maxTrackedKeys: number;
}

export interface RateLimiter {
  /** Records a request for `key` and reports whether it exceeds the limit. */
  isRateLimited(key: string): boolean;
  /** Callers currently tracked; never above `maxTrackedKeys`. */
  readonly size: number;
}

/**
 * In-memory sliding-window limiter for a single process.
 *
 * Keys must be derived from a verified identity: a caller who can pick their
 * own key can reset their own budget. The tracking map is bounded so that a
 * flood of distinct callers cannot grow it without limit; entries are held in
 * least-recently-seen order and the coldest ones are dropped first, which keeps
 * an active flooder's bucket (and therefore its block) in place.
 */
export function createRateLimiter({
  windowMs,
  maxRequests,
  maxTrackedKeys,
}: RateLimiterOptions): RateLimiter {
  const requestsByKey = new Map<string, number[]>();

  function evictColdestKeys(): void {
    for (const key of requestsByKey.keys()) {
      if (requestsByKey.size <= maxTrackedKeys) return;
      requestsByKey.delete(key);
    }
  }

  return {
    isRateLimited(key: string): boolean {
      const now = Date.now();
      const cutoff = now - windowMs;

      const timestamps = (requestsByKey.get(key) ?? []).filter(
        (timestamp) => timestamp > cutoff,
      );
      const limited = timestamps.length >= maxRequests;
      if (!limited) {
        timestamps.push(now);
      }

      // Re-insert so the map stays ordered by how recently a caller was seen.
      requestsByKey.delete(key);
      requestsByKey.set(key, timestamps);
      evictColdestKeys();

      return limited;
    },

    get size(): number {
      return requestsByKey.size;
    },
  };
}
