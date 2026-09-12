/**
 * The server's own reading of the clock, in ISO-8601 UTC.
 *
 * Timed attempts persist an absolute `expiresAt`. A client that subtracts its
 * own `Date.now()` from that value inherits every bit of device clock skew, so
 * the attempt responses carry this reading next to `expiresAt`: the learner UI
 * takes `serverNow - deviceNow` once, on arrival, and runs the countdown
 * against the corrected clock thereafter.
 */
export const readServerClock = (): string => new Date().toISOString();
