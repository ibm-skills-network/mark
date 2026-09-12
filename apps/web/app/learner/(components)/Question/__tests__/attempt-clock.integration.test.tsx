/**
 * @jest-environment jsdom
 *
 * End-to-end across the learner clock wiring: the attempt payload's serverNow
 * reaches the store through QuestionPage, and the real countdown hook inside
 * Timer runs against it. Only the network, the router and the sibling question
 * UI are stubbed.
 */

import { act, render, screen } from "@testing-library/react";
import type { AssignmentAttemptWithQuestions } from "@/config/types";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import QuestionPage from "../index";
import Timer from "../Timer";

jest.mock("next/navigation", () => ({
  useParams: () => ({ assignmentId: "3663" }),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

const mockSubmitAssignment = jest.fn();
jest.mock("@/lib/talkToBackend", () => ({
  getAssignment: jest.fn().mockResolvedValue(undefined),
  getUser: jest.fn().mockResolvedValue({ role: "learner" }),
  submitAssignment: (...args: unknown[]) => mockSubmitAssignment(...args),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), warning: jest.fn(), message: jest.fn() },
}));

jest.mock("../QuestionContainer", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../Overview", () => ({ __esModule: true, default: () => null }));
jest.mock("../TipsView", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/Loading", () => ({
  __esModule: true,
  default: () => null,
}));

const MINUTE = 60 * 1000;
const SERVER_NOW = Date.parse("2026-09-12T12:00:00.000Z");

const buildAttempt = (
  overrides: Partial<AssignmentAttemptWithQuestions> = {},
): AssignmentAttemptWithQuestions =>
  ({
    id: 2493,
    assignmentId: 3663,
    submitted: false,
    createdAt: new Date(SERVER_NOW).toISOString(),
    expiresAt: new Date(SERVER_NOW + 20 * MINUTE).toISOString(),
    serverNow: new Date(SERVER_NOW).toISOString(),
    questions: [
      {
        id: 10072,
        question: "timer-verify Q1",
        totalPoints: 1,
        type: "SINGLE_CORRECT",
      },
    ],
    assignmentDetails: {
      id: 3663,
      name: "timer-verify clock skew check",
      allotedTimeMinutes: 20,
      questionDisplay: "ONE_PER_PAGE",
    },
    ...overrides,
  }) as unknown as AssignmentAttemptWithQuestions;

/** The clock face, whose digits render as separate text nodes. */
const timerReadout = (): string =>
  screen
    .getByText("Time Remaining:")
    .parentElement?.textContent?.replace("Time Remaining:", "")
    .trim() ?? "";

const renderLearnerPage = async (attempt: AssignmentAttemptWithQuestions) => {
  const view = render(
    <>
      <QuestionPage attempt={attempt} assignmentId={3663} />
      <Timer />
    </>,
  );
  // Let QuestionPage's hydration effect write the clock fields to the store.
  await act(async () => {
    await Promise.resolve();
  });
  return view;
};

describe("learner attempt clock, end to end", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
    useLearnerStore.setState({
      questions: [],
      activeAttemptId: null,
      expiresAt: undefined,
      serverTimeOffsetMs: undefined,
      attemptStartedAt: undefined,
      userPreferedLanguage: null,
    });
    useAssignmentDetails.setState({ assignmentDetails: null });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("shows the server's remaining time on a device whose clock is 25 minutes fast", async () => {
    // A 20-minute attempt created "now" on the server, opened on a device that
    // believes it is already five minutes past the deadline.
    jest.setSystemTime(SERVER_NOW + 25 * MINUTE);

    await renderLearnerPage(buildAttempt());

    expect(useLearnerStore.getState().serverTimeOffsetMs).toBe(-25 * MINUTE);
    expect(useLearnerStore.getState().attemptStartedAt).toBe(SERVER_NOW);
    expect(timerReadout()).toBe("00:20:00");
  });

  it("does not auto-submit that attempt", async () => {
    jest.setSystemTime(SERVER_NOW + 25 * MINUTE);

    await renderLearnerPage(buildAttempt());

    // In stages, so React flushes the countdown's state updates between ticks
    // and the auto-submit path gets every chance to fire. Well past both the
    // two-second submit delay and the thirty-second minimum-age hold.
    for (let tick = 0; tick < 6; tick++) {
      await act(async () => {
        jest.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
    }

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
    // Still ticking down from the server's twenty minutes, not sitting at zero.
    expect(timerReadout()).toBe("00:19:00");
    expect(useLearnerStore.getState().activeAttemptId).toBe(2493);
  });

  it("falls back to the device clock when the payload carries no server time", async () => {
    jest.setSystemTime(SERVER_NOW + 25 * MINUTE);

    await renderLearnerPage(buildAttempt({ serverNow: undefined }));

    expect(useLearnerStore.getState().serverTimeOffsetMs).toBeUndefined();
    // Uncorrected, the device clock says this attempt is already over. With no
    // server clock to check it against, the guard measures how long this tab
    // has held the attempt — seconds — and refuses to post a blank submission.
    for (let tick = 0; tick < 3; tick++) {
      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });
    }
    expect(mockSubmitAssignment).not.toHaveBeenCalled();
  });
});

/**
 * The minimum-age hold delays a suspicious expiry; it must never cancel it.
 * These cases drive the real `useCountdown` past the hold and assert the
 * submission actually lands — the mocked-hook Timer spec cannot express this,
 * because its `timerExpired` is pinned and its `resetCountdown` is inert.
 */
describe("timed auto-submit survives the minimum-age hold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
    mockSubmitAssignment.mockResolvedValue({
      id: 8811,
      totalPointsEarned: 0,
      totalPossiblePoints: 1,
      showSubmissionFeedback: true,
      feedbacksForQuestions: [],
    });
    useLearnerStore.setState({
      questions: [],
      activeAttemptId: null,
      expiresAt: undefined,
      serverTimeOffsetMs: undefined,
      attemptStartedAt: undefined,
      userPreferedLanguage: null,
    });
    useAssignmentDetails.setState({ assignmentDetails: null });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  /**
   * One second at a time, flushing React between ticks: the countdown, the
   * hold's retry timer and the submit delay are three separate timers and the
   * effects that chain them only run when React commits in between.
   */
  const advanceBy = async (totalMs: number) => {
    for (let elapsed = 0; elapsed < totalMs; elapsed += 1000) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });
    }
  };

  it("submits once when an attempt the learner has held for ten minutes runs out", async () => {
    jest.setSystemTime(SERVER_NOW);

    await renderLearnerPage(
      buildAttempt({
        createdAt: new Date(SERVER_NOW - 10 * MINUTE).toISOString(),
        expiresAt: new Date(SERVER_NOW + 10 * 1000).toISOString(),
      }),
    );

    // Ten seconds to the deadline, two more for the submit delay.
    await advanceBy(20 * 1000);

    expect(mockSubmitAssignment).toHaveBeenCalledTimes(1);
  });

  it("submits once, after the hold, for an attempt that expires in its first seconds", async () => {
    jest.setSystemTime(SERVER_NOW);

    // Three seconds old with two seconds left: the hold engages, because an
    // attempt this young expiring is exactly the shape a wrong clock produces.
    // It is still a real deadline, so the submit must land once the attempt is
    // old enough to be credible.
    await renderLearnerPage(
      buildAttempt({
        createdAt: new Date(SERVER_NOW - 3 * 1000).toISOString(),
        expiresAt: new Date(SERVER_NOW + 2 * 1000).toISOString(),
      }),
    );

    await advanceBy(20 * 1000);
    expect(mockSubmitAssignment).not.toHaveBeenCalled();

    await advanceBy(100 * 1000);
    expect(mockSubmitAssignment).toHaveBeenCalledTimes(1);
  });

  it("submits once on a payload with no server time and a device clock 25 minutes fast", async () => {
    jest.setSystemTime(SERVER_NOW + 25 * MINUTE);

    await renderLearnerPage(buildAttempt({ serverNow: undefined }));

    // The uncorrected device clock reads the attempt as already over. The hold
    // measures how long this tab has held it instead, so nothing is posted for
    // the first thirty seconds...
    await advanceBy(20 * 1000);
    expect(mockSubmitAssignment).not.toHaveBeenCalled();

    // ...and then the deadline is honoured rather than dropped.
    await advanceBy(70 * 1000);
    expect(mockSubmitAssignment).toHaveBeenCalledTimes(1);
  });

  it("does not carry a held expiry over to the next attempt", async () => {
    jest.setSystemTime(SERVER_NOW);

    // An attempt that expires while still too young to submit: the hold is
    // engaged and the expiry is remembered.
    const view = await renderLearnerPage(
      buildAttempt({
        createdAt: new Date(SERVER_NOW - 3 * 1000).toISOString(),
        expiresAt: new Date(SERVER_NOW + 2 * 1000).toISOString(),
      }),
    );
    await advanceBy(5 * 1000);
    expect(mockSubmitAssignment).not.toHaveBeenCalled();

    // The learner starts a fresh attempt with a full twenty minutes before the
    // hold elapses. The remembered expiry belongs to the old deadline and must
    // not submit this one out from under them.
    const restartedAt = Date.now();
    view.rerender(
      <>
        <QuestionPage
          attempt={buildAttempt({
            id: 2494,
            createdAt: new Date(restartedAt).toISOString(),
            serverNow: new Date(restartedAt).toISOString(),
            expiresAt: new Date(restartedAt + 20 * MINUTE).toISOString(),
          })}
          assignmentId={3663}
        />
        <Timer />
      </>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    await advanceBy(120 * 1000);

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
    expect(useLearnerStore.getState().activeAttemptId).toBe(2494);
  });
});
