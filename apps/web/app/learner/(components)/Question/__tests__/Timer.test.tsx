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

// Report the timer as already expired so the auto-submit effect fires on mount.
jest.mock("@/hooks/use-countdown", () => ({
  __esModule: true,
  default: () => ({
    countdown: 0,
    timerExpired: true,
    resetCountdown: jest.fn(),
  }),
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

describe("Timer auto-submit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
    useLearnerStore.setState({
      questions: [answeredQuestion],
      activeAttemptId: 999,
      userPreferedLanguage: null,
    });
    useAssignmentDetails.setState({ assignmentDetails: null });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
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
