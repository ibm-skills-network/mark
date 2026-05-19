import type IORedis from "ioredis";

/**
 * Key prefix for the per-assignment in-flight language refcount hash
 * maintained by the publish-time translation worker producer. Each field is
 * a language code; the value is the count of workers (per-question +
 * per-variant + per-meta) currently translating that language for the
 * assignment. A field count > 0 means at least one worker is still
 * processing that language; 0 or absent means none are.
 *
 * The hash schema replaces a previous SET-of-language-codes design that
 * leaked completion mid-publish: the first worker to finish a language
 * removed the language from the SET, even when sibling workers were still
 * mid-LLM for the same language, and learners reading the SET then saw
 * "unavailable" instead of "pending" for in-flight rows.
 */
export const TRANSLATION_INFLIGHT_KEY_PREFIX = "mark:translation:in-flight";

/**
 * Wall-clock fallback for the in-flight refcount hash. If the publish job
 * dies before its workers can decrement each language counter, the hash
 * still expires after this window — the learner-side loop then resolves any
 * missing Translation row as "unavailable" rather than "pending" forever.
 */
export const TRANSLATION_INFLIGHT_TTL_SECONDS = 1800;

/**
 * Build the Redis hash key for a single assignment's in-flight language
 * refcounts.
 */
export function buildInflightKey(assignmentId: number): string {
  return `${TRANSLATION_INFLIGHT_KEY_PREFIX}:${assignmentId}`;
}

/**
 * Seed the in-flight refcount hash for an assignment. Called by the publish
 * producer before fanning out translation jobs. Each supported language
 * gets its counter incremented by `perLanguageCount` — the number of
 * workers that will process that language across the upcoming fan-out
 * (per-question + per-variant + per-meta job count, uniform across
 * languages because every translation worker handles all 23).
 *
 * Idempotent under reseed: HINCRBY adds to existing counters. A re-publish
 * of an already-running assignment cleanly stacks. Each call refreshes the
 * TTL fallback.
 */
export async function seedInflightLanguages(
  redis: IORedis,
  assignmentId: number,
  languages: string[],
  perLanguageCount: number,
): Promise<void> {
  if (languages.length === 0 || perLanguageCount <= 0) return;
  const key = buildInflightKey(assignmentId);
  const pipeline = redis.multi();
  for (const language of languages) {
    pipeline.hincrby(key, language, perLanguageCount);
  }
  pipeline.expire(key, TRANSLATION_INFLIGHT_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Decrement a single language's in-flight counter by 1. Called from every
 * per-language terminal closure (success or failure) inside the worker
 * fan-out loops. Leaves the field at 0 rather than deleting it — that's
 * indistinguishable from "absent" for the read path, and avoids a second
 * round-trip.
 *
 * A Redis blip is the caller's responsibility to log and swallow — this
 * helper does not handle errors. The TTL fallback eventually clears stuck
 * counters regardless.
 */
export async function decrementInflightLanguage(
  redis: IORedis,
  assignmentId: number,
  language: string,
): Promise<void> {
  // Clamp at 0 so BullMQ retries cannot push the counter negative.
  // A retried worker calls this again against a seed that was only
  // incremented once at enqueue time; without the floor the counter
  // goes negative and corrupts the next publish's seed for this
  // assignment/language pair.
  await redis.eval(
    `local v = tonumber(redis.call('HGET', KEYS[1], ARGV[1])) or 0
     if v > 0 then redis.call('HINCRBY', KEYS[1], ARGV[1], -1) end
     return 0`,
    1,
    buildInflightKey(assignmentId),
    language,
  );
}

/**
 * Returns true iff at least one worker is still processing the given
 * language for the assignment (refcount > 0).
 *
 * Tolerates the hash being absent (returns false) — HGET on a missing key
 * returns null, which parses to NaN, which is not > 0. Callers treat an
 * absent hash as "no translation jobs are in-flight for this assignment",
 * which downstream resolves to an "unavailable" marker for any question
 * whose Translation row is also missing.
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
  try {
    const raw = await redis.hget(key, language);
    if (raw === null) return false;
    const count = Number.parseInt(raw, 10);
    return Number.isFinite(count) && count > 0;
  } catch {
    // Redis blip: fail open so callers resolve to "unavailable" rather
    // than propagating a 500 to the learner request.
    return false;
  }
}
