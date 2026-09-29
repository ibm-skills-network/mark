/**
 * @jest-environment jsdom
 */

import { render, act } from "@testing-library/react";
import { toast } from "sonner";
import type { QuestionStore } from "@/config/types";
import { GradingStreamLostError } from "@/lib/learner";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import Timer from "../Timer";

const mockUseParams = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

// Countdown state the tests drive directly; defaults to "already expired" so
// the auto-submit effect fires on mount.
const mockCountdownState: {
  countdown: number | undefined;
  timerExpired: boolean;
  resetCountdown: jest.Mock;
} = {
  countdown: 0,
  timerExpired: true,
  resetCountdown: jest.fn(),
};
const mockCountdownCalls: unknown[][] = [];
jest.mock("@/hooks/use-countdown", () => ({
  __esModule: true,
  default: (...args: unknown[]) => {
    mockCountdownCalls.push(args);
    return mockCountdownState;
  },
}));

const mockSubmitAssignment = jest.fn();
jest.mock("@/lib/talkToBackend", () => ({
  submitAssignment: (...args: unknown[]) => mockSubmitAssignment(...args),
  getUser: jest.fn().mockResolvedValue({ role: "learner" }),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), warning: jest.fn(), message: jest.fn() },
}));

const answeredQuestion = {
  id: 1,
  learnerTextResponse: "my answer",
} as unknown as QuestionStore;

/** An attempt the learner has genuinely been sitting on for ten minutes. */
const anEstablishedAttempt = () => Date.now() - 10 * 60 * 1000;

describe("Timer auto-submit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
    mockCountdownState.countdown = 0;
    mockCountdownState.timerExpired = true;
    mockCountdownCalls.length = 0;
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
      attemptStartedAt: anEstablishedAttempt(),
      serverTimeOffsetMs: 0,
    });
    useAssignmentDetails.setState({ assignmentDetails: null });
  });

  afterEach(() => {
    // Inside act(): draining the minimum-age hold re-runs the auto-submit
    // effect, and React warns about unwrapped updates otherwise.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("auto-submits with the assignmentId from the URL even when assignmentDetails is null", async () => {
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    mockSubmitAssignment.mockResolvedValue(undefined);

    render(<Timer />);

    // The auto-submit effect schedules the submit ~2s after expiry.
    await act(async () => {
      jest.advanceTimersByTime(2100);
    });

    expect(mockSubmitAssignment).toHaveBeenCalled();
    expect(mockSubmitAssignment.mock.calls[0][0]).toBe(3428);
  });

  it("surfaces an error toast when the timed auto-submit rejects, instead of losing it silently", async () => {
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    // A 401/network failure during the fire-and-forget auto-submit must not be
    // swallowed: the learner has to learn the submission did not go through.
    mockSubmitAssignment.mockRejectedValue(new Error("Unauthorized"));

    render(<Timer />);

    await act(async () => {
      jest.advanceTimersByTime(2100);
      // Flush the chain of microtasks the awaited (rejected) submitAssignment
      // schedules so the catch's toast.error has run before we assert.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSubmitAssignment).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("tells the learner their answers were submitted when the grading stream is lost, instead of prompting a resubmission", async () => {
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    // The submission succeeded server-side; only the watchdog gave up on the
    // stream. The generic "use the Submit button to try again" copy would be
    // actively wrong here and risks a duplicate attempt.
    const lostStreamMessage =
      "We lost contact with the grading service. Your answers were submitted — check your results in a moment.";
    mockSubmitAssignment.mockRejectedValue(
      new GradingStreamLostError(lostStreamMessage, 3428, 999, "disconnected"),
    );

    render(<Timer />);

    await act(async () => {
      jest.advanceTimersByTime(2100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSubmitAssignment).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(lostStreamMessage);
  });
});

describe("Timer clock-skew guards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
    mockCountdownState.countdown = 0;
    mockCountdownState.timerExpired = true;
    mockCountdownCalls.length = 0;
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    mockSubmitAssignment.mockResolvedValue(undefined);
    useAssignmentDetails.setState({ assignmentDetails: null });
  });

  afterEach(() => {
    // Inside act(): draining the minimum-age hold re-runs the auto-submit
    // effect, and React warns about unwrapped updates otherwise.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("runs the countdown against the server clock offset held in the store", () => {
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
      expiresAt: Date.now() + 600_000,
      attemptStartedAt: anEstablishedAttempt(),
      serverTimeOffsetMs: -600_000,
    });
    mockCountdownState.timerExpired = false;
    mockCountdownState.countdown = 600_000;

    render(<Timer />);

    expect(mockCountdownCalls[0][1]).toBe(-600_000);
  });

  it("does not auto-submit an attempt that was created seconds ago", async () => {
    // The exact reported failure: a device clock far ahead of the server marks
    // a brand-new attempt as expired, and the old code posted blank answers.
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
      attemptStartedAt: Date.now() - 3000,
      serverTimeOffsetMs: 0,
    });

    render(<Timer />);

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
  });

  it("auto-submits once the attempt is past the minimum age", async () => {
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
      attemptStartedAt: Date.now() - 3000,
      serverTimeOffsetMs: 0,
    });

    render(<Timer />);

    // Past the minimum age...
    await act(async () => {
      jest.advanceTimersByTime(27_100);
      await Promise.resolve();
    });
    // ...then the usual two-second grace before the submit fires.
    await act(async () => {
      jest.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    expect(mockSubmitAssignment).toHaveBeenCalled();
  });

  it("falls back to the time the attempt was opened when the server gave no creation time", async () => {
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
      attemptStartedAt: undefined,
      serverTimeOffsetMs: 0,
    });

    render(<Timer />);

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
  });

  it("does not warn about one minute remaining when the countdown is negative", () => {
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
      expiresAt: Date.now() + 600_000,
      attemptStartedAt: Date.now() - 3000,
      serverTimeOffsetMs: 0,
    });
    mockCountdownState.timerExpired = false;
    mockCountdownState.countdown = -300_000;

    render(<Timer />);

    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("still warns when a real minute is left", () => {
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
      expiresAt: Date.now() + 45_000,
      attemptStartedAt: anEstablishedAttempt(),
      serverTimeOffsetMs: 0,
    });
    mockCountdownState.timerExpired = false;
    mockCountdownState.countdown = 45_000;

    render(<Timer />);

    expect(toast.warning).toHaveBeenCalled();
  });
});
