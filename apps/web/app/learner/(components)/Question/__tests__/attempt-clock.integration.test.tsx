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
