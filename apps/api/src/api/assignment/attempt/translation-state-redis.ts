import type IORedis from "ioredis";

/**
 * Key prefix for the per-assignment in-flight language SET maintained by the
 * publish-time translation worker producer. Membership of a language code in
 * the SET means at least one translation worker for that (assignment, language)
 * pair is enqueued, running, or has not yet terminated.
 */
export const TRANSLATION_INFLIGHT_KEY_PREFIX = "mark:translation:in-flight";

/**
 * Build the Redis SET key for a single assignment's in-flight language set.
 */
export function buildInflightKey(assignmentId: number): string {
  return `${TRANSLATION_INFLIGHT_KEY_PREFIX}:${assignmentId}`;
}

/**
 * Returns true iff the given language is a member of the per-assignment
 * in-flight SET.
 *
 * Tolerates the SET being absent (returns false) — SISMEMBER on a missing key
 * is defined by Redis to return 0. Callers treat an absent SET as "no
 * translation jobs are in-flight for this assignment", which downstream
 * resolves to an "unavailable" marker for any question whose Translation row
 * is also missing.
 *
 * The caller MUST pass an IORedis connection whose lifecycle is owned
 * elsewhere (NestJS-managed singleton or per-service connection). This
 * helper does not create or close connections.
 */
export async function isLanguageInFlight(
  redis: IORedis,
  assignmentId: number,
  language: string,
): Promise<boolean> {
  const key = buildInflightKey(assignmentId);
  const result = await redis.sismember(key, language);
  return result === 1;
}
