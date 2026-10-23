import {
  ATTEMPT_ALREADY_SUBMITTED_CODE,
  ATTEMPT_CLOSED_AT_TIME_LIMIT_CODE,
  ATTEMPT_SUBMISSION_GRACE_MS,
  AttemptClosedException,
  EXPIRED_ATTEMPT_COMMENT,
  isFinalSubmitBeforeDeadline,
  isPastSubmissionGrace,
  wasClosedAtTimeLimit,
} from "./submission-deadline.helper";

describe("submission deadline", () => {
  // A 45-minute attempt whose timed auto-submit reached the API 11.7s after
  // the deadline: the client fired on its next tick, waited its 2s delay,
  // and the request then crossed the network and the Next proxy.
  const expiresAt = new Date("2026-10-21T01:16:03.499Z");
  const autoSubmitReceivedAt = new Date("2026-10-21T01:16:15.160Z");

  it("allows thirty seconds after the deadline", () => {
    expect(ATTEMPT_SUBMISSION_GRACE_MS).toBe(30_000);
  });

  it("accepts an auto-submit that arrives seconds after the deadline", () => {
    expect(isPastSubmissionGrace(expiresAt, autoSubmitReceivedAt)).toBe(false);
  });

  it("accepts a submit exactly at the end of the grace window", () => {
    const edge = new Date(expiresAt.getTime() + ATTEMPT_SUBMISSION_GRACE_MS);
    expect(isPastSubmissionGrace(expiresAt, edge)).toBe(false);
  });

  it("rejects a submit received after the grace window", () => {
    const late = new Date(
      expiresAt.getTime() + ATTEMPT_SUBMISSION_GRACE_MS + 1,
    );
    expect(isPastSubmissionGrace(expiresAt, late)).toBe(true);
  });

  it("never expires an untimed attempt", () => {
    expect(isPastSubmissionGrace(null, autoSubmitReceivedAt)).toBe(false);
    expect(isPastSubmissionGrace(undefined, autoSubmitReceivedAt)).toBe(false);
  });

  it("accepts an ISO string deadline", () => {
    expect(
      isPastSubmissionGrace(expiresAt.toISOString(), autoSubmitReceivedAt),
    ).toBe(false);
  });

  it("recognises attempts the deadline checks closed", () => {
    expect(wasClosedAtTimeLimit(EXPIRED_ATTEMPT_COMMENT)).toBe(true);
    expect(
      wasClosedAtTimeLimit(
        "Your assignment was automatically submitted because the time limit was reached. No responses were recorded.",
      ),
    ).toBe(true);
    expect(wasClosedAtTimeLimit(null)).toBe(false);
    expect(wasClosedAtTimeLimit("Great work")).toBe(false);
  });

  it("builds a coded 409 for a time-limit closure", () => {
    const error = new AttemptClosedException(1873208, "time_limit");
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      statusCode: 409,
      code: ATTEMPT_CLOSED_AT_TIME_LIMIT_CODE,
      message: "This attempt was already closed at its time limit.",
    });
    expect(error.learnerMessage).toBe(
      "This attempt was already closed at its time limit.",
    );
    expect(error.message).not.toContain("Grading failed");
  });

  it("builds a coded 409 for an ordinary duplicate submit", () => {
    const error = new AttemptClosedException(42, "already_submitted");
    expect(error.getResponse()).toMatchObject({
      code: ATTEMPT_ALREADY_SUBMITTED_CODE,
      message: "This attempt has already been submitted.",
    });
  });

  it("treats a submit inside the last minute, or past the deadline, as final", () => {
    const expiresAt = new Date("2026-10-23T15:00:00.000Z");
    const at = (iso: string) => new Date(iso);
    expect(
      isFinalSubmitBeforeDeadline(expiresAt, at("2026-10-23T14:58:59.000Z")),
    ).toBe(false);
    expect(
      isFinalSubmitBeforeDeadline(expiresAt, at("2026-10-23T14:59:00.000Z")),
    ).toBe(true);
    expect(
      isFinalSubmitBeforeDeadline(expiresAt, at("2026-10-23T15:00:12.000Z")),
    ).toBe(true);
    expect(isFinalSubmitBeforeDeadline(null)).toBe(false);
  });
});
