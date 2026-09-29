import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { RetryableUrlFetchError } from "src/api/llm/features/grading/errors/retryable-url-fetch.error";
import { JOB_QUEUE_NAMES } from "./job-queue.constants";
import {
  ATTEMPT_RETRY_BACKOFF,
  ATTEMPT_RETRY_BACKOFF_TYPE,
  RETRYABLE_FETCH_BASE_DELAY_MS,
  RETRYABLE_FETCH_MAX_DELAY_MS,
  calculateAttemptRetryDelayMs,
  queueUsesAttemptRetryBackoff,
} from "./attempt-retry-backoff";

const transientError = (): RetryableUrlFetchError =>
  new RetryableUrlFetchError({
    requestUrl: "https://example.com/page",
    reason: "timeout",
  });

describe("calculateAttemptRetryDelayMs", () => {
  describe("failures that are not transient URL fetches", () => {
    // Zero means "retry immediately", which is exactly what the attempt
    // queues did for every failure before the transient-fetch class existed.
    // These cases pin that behaviour so the new delay cannot leak onto
    // unrelated failures (OOM strikes, executor faults, decrypt errors).
    it.each([
      ["a generic error", new Error("grading exploded")],
      ["a type error", new TypeError("undefined is not a function")],
      [
        "a terminal learner-facing error",
        Object.assign(new Error("file too large"), {
          name: "OversizedSubmissionError",
        }),
      ],
      ["a non-error value", "just a string"],
      ["no error at all", undefined],
    ])("retries immediately for %s", (_label, error) => {
      expect(
        calculateAttemptRetryDelayMs(1, error, { random: () => 0.5 }),
      ).toBe(0);
    });
  });

  describe("transient URL fetch failures", () => {
    it("waits at least half of the first window before the first retry", () => {
      expect(
        calculateAttemptRetryDelayMs(1, transientError(), { random: () => 0 }),
      ).toBe(RETRYABLE_FETCH_BASE_DELAY_MS / 2);
      expect(
        calculateAttemptRetryDelayMs(1, transientError(), { random: () => 1 }),
      ).toBe(RETRYABLE_FETCH_BASE_DELAY_MS);
    });

    it("doubles the window on every further attempt", () => {
      expect(
        calculateAttemptRetryDelayMs(2, transientError(), { random: () => 1 }),
      ).toBe(RETRYABLE_FETCH_BASE_DELAY_MS * 2);
      expect(
        calculateAttemptRetryDelayMs(3, transientError(), { random: () => 1 }),
      ).toBe(RETRYABLE_FETCH_BASE_DELAY_MS * 4);
      expect(
        calculateAttemptRetryDelayMs(2, transientError(), { random: () => 0 }),
      ).toBe(RETRYABLE_FETCH_BASE_DELAY_MS);
    });

    it("spreads retries across the window instead of firing them in lockstep", () => {
      const randoms = [0.01, 0.2, 0.37, 0.58, 0.79, 0.99];
      const delays = randoms.map((value) =>
        calculateAttemptRetryDelayMs(1, transientError(), {
          random: () => value,
        }),
      );

      expect(new Set(delays).size).toBeGreaterThan(1);
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(RETRYABLE_FETCH_BASE_DELAY_MS / 2);
        expect(delay).toBeLessThanOrEqual(RETRYABLE_FETCH_BASE_DELAY_MS);
      }
    });

    it("never waits longer than the ceiling, however many attempts are made", () => {
      expect(
        calculateAttemptRetryDelayMs(20, transientError(), { random: () => 1 }),
      ).toBe(RETRYABLE_FETCH_MAX_DELAY_MS);
    });

    it("applies to the rate-limit subclass and to a name-only copy of the error", () => {
      const subclassDelay = calculateAttemptRetryDelayMs(
        1,
        new GithubRateLimitedError({
          owner: "octocat",
          repo: "hello-world",
          requestUrl: "https://api.github.com/repos/octocat/hello-world",
        }),
        { random: () => 1 },
      );
      // The executor boundary can flatten the class down to its name; the
      // worker still has to recognise it.
      const nameOnlyDelay = calculateAttemptRetryDelayMs(
        1,
        Object.assign(new Error("temporarily unable to read the link"), {
          name: "RetryableUrlFetchError",
        }),
        { random: () => 1 },
      );

      expect(subclassDelay).toBe(RETRYABLE_FETCH_BASE_DELAY_MS);
      expect(nameOnlyDelay).toBe(RETRYABLE_FETCH_BASE_DELAY_MS);
    });
  });

  describe("rate limits that tell us when to come back", () => {
    const rateLimited = (
      fields: { resetAt?: number; retryAfterSeconds?: number } = {},
    ): GithubRateLimitedError =>
      new GithubRateLimitedError({
        owner: "octocat",
        repo: "hello-world",
        requestUrl: "https://api.github.com/repos/octocat/hello-world",
        ...fields,
      });

    it("waits out a retry-after header that outlasts the computed window", () => {
      expect(
        calculateAttemptRetryDelayMs(
          1,
          rateLimited({ retryAfterSeconds: 90 }),
          {
            random: () => 0,
          },
        ),
      ).toBe(90_000);
    });

    it("waits out a reset timestamp that outlasts the computed window", () => {
      const now = 1_700_000_000_000;
      expect(
        calculateAttemptRetryDelayMs(
          1,
          rateLimited({ resetAt: Math.floor(now / 1000) + 120 }),
          { random: () => 0, now: () => now },
        ),
      ).toBe(120_000);
    });

    it("ignores a reset timestamp that has already passed", () => {
      const now = 1_700_000_000_000;
      expect(
        calculateAttemptRetryDelayMs(
          1,
          rateLimited({ resetAt: Math.floor(now / 1000) - 600 }),
          { random: () => 1, now: () => now },
        ),
      ).toBe(RETRYABLE_FETCH_BASE_DELAY_MS);
    });

    it("still caps a very distant reset at the ceiling", () => {
      expect(
        calculateAttemptRetryDelayMs(
          1,
          rateLimited({ retryAfterSeconds: 3600 }),
          { random: () => 0 },
        ),
      ).toBe(RETRYABLE_FETCH_MAX_DELAY_MS);
    });
  });
});

describe("queueUsesAttemptRetryBackoff", () => {
  it("covers both attempt-grading queues and nothing else", () => {
    expect(queueUsesAttemptRetryBackoff(JOB_QUEUE_NAMES.ATTEMPT)).toBe(true);
    expect(queueUsesAttemptRetryBackoff(JOB_QUEUE_NAMES.ATTEMPT_HEAVY)).toBe(
      true,
    );
    expect(queueUsesAttemptRetryBackoff(JOB_QUEUE_NAMES.ASSIGNMENT_V2)).toBe(
      false,
    );
    expect(
      queueUsesAttemptRetryBackoff(JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS),
    ).toBe(false);
  });

  it("names a strategy the worker has to register, never a built-in", () => {
    expect(ATTEMPT_RETRY_BACKOFF).toEqual({
      type: ATTEMPT_RETRY_BACKOFF_TYPE,
    });
    expect(["fixed", "exponential"]).not.toContain(ATTEMPT_RETRY_BACKOFF_TYPE);
  });
});
