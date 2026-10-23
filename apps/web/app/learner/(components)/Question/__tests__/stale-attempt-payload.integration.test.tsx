/**
 * @jest-environment jsdom
 *
 * The questions page can be re-mounted from a cached attempt payload long
 * after it was fetched (router cache, back/forward cache). Its `serverNow` is
 * then as old as the payload and its `submitted` flag may be out of date. The
 * page must take its clock and its open/closed state from a fresh read.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AssignmentAttemptWithQuestions } from "@/config/types";
import { getAttemptSubmissionStatus } from "@/lib/attempt-submission-status";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import QuestionPage from "../index";
import Timer from "../Timer";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ assignmentId: "771" }),
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/attempt-submission-status", () => ({
  ...jest.requireActual("@/lib/attempt-submission-status"),
  getAttemptSubmissionStatus: jest.fn(),
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
jest.mock("../Overview", () => ({
  __esModule: true,
  default: () => <div data-testid="editable-attempt" />,
}));
jest.mock("../TipsView", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/Loading", () => ({
  __esModule: true,
  default: () => null,
}));

const mockStatus = getAttemptSubmissionStatus as jest.Mock;
const MINUTE = 60 * 1000;
// Device clock and server clock agree; only the payload is old.
const NOW = Date.parse("2026-10-21T01:16:24.000Z");
const ATTEMPT_CREATED = NOW - 45 * MINUTE - 21_000;
const EXPIRES_AT = ATTEMPT_CREATED + 45 * MINUTE;

const stalePayload = (
  overrides: Partial<AssignmentAttemptWithQuestions> = {},
): AssignmentAttemptWithQuestions =>
  ({
    id: 1873208,
    assignmentId: 771,
    submitted: false,
    createdAt: new Date(ATTEMPT_CREATED).toISOString(),
    expiresAt: new Date(EXPIRES_AT).toISOString(),
    // Read when the payload was fetched, right after the attempt was created.
    serverNow: new Date(ATTEMPT_CREATED + 1000).toISOString(),
    questions: [
      {
        id: 1,
        question: "Upload your notebook",
        totalPoints: 1,
        type: "UPLOAD",
      },
    ],
    assignmentDetails: {
      id: 771,
      name: "Timed notebook",
      allotedTimeMinutes: 45,
      questionDisplay: "ONE_PER_PAGE",
    },
    ...overrides,
  }) as unknown as AssignmentAttemptWithQuestions;

const freshStatus = (
  overrides: Record<string, unknown> = {},
  serverTimeOffsetMs = 0,
) => ({
  ok: true,
  serverTimeOffsetMs,
  status: {
    id: 1873208,
    submitted: false,
    closedAtTimeLimit: false,
    acceptingSubmissions: true,
    expiresAt: new Date(EXPIRES_AT).toISOString(),
    serverNow: new Date(NOW).toISOString(),
    ...overrides,
  },
});

const closedAtTimeLimit = () =>
  freshStatus({
    submitted: true,
    closedAtTimeLimit: true,
    acceptingSubmissions: false,
  });

const timerReadout = (): string =>
  screen
    .getByText("Time Remaining:")
    .parentElement?.textContent?.replace("Time Remaining:", "")
    .trim() ?? "";

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderPage = async (attempt: AssignmentAttemptWithQuestions) => {
  const view = render(
    <>
      <QuestionPage attempt={attempt} assignmentId={771} />
      <Timer />
    </>,
  );
  await flush();
  return view;
};

describe("questions page mounted from a stale attempt payload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    localStorage.clear();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
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

  it("shows a closed attempt as closed, not as 45 editable minutes", async () => {
    mockStatus.mockResolvedValue(closedAtTimeLimit());

    await renderPage(stalePayload());

    expect(mockStatus).toHaveBeenCalledWith(771, 1873208);
    expect(screen.getByText("This attempt is closed")).toBeInTheDocument();
    expect(
      screen.getByText("This attempt was already closed at its time limit."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("editable-attempt")).not.toBeInTheDocument();
    expect(timerReadout()).toBe("--:--:--");
    expect(useLearnerStore.getState().expiresAt).toBeUndefined();

    fireEvent.click(screen.getByText("View results"));
    expect(mockPush).toHaveBeenCalledWith("/learner/771/successPage/1873208");
  });

  it("never submits a closed attempt", async () => {
    mockStatus.mockResolvedValue(closedAtTimeLimit());

    await renderPage(stalePayload());
    for (let tick = 0; tick < 12; tick++) {
      await act(async () => {
        jest.advanceTimersByTime(10_000);
        await Promise.resolve();
      });
    }

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
  });

  it("runs the countdown on the fresh clock, not the payload's", async () => {
    // Ten minutes into a twenty-minute attempt, mounted from the payload
    // fetched when it started. The payload's clock says no time has passed.
    const created = NOW - 10 * MINUTE;
    mockStatus.mockResolvedValue(
      freshStatus({ expiresAt: new Date(created + 20 * MINUTE).toISOString() }),
    );

    await renderPage(
      stalePayload({
        createdAt: new Date(created).toISOString(),
        serverNow: new Date(created).toISOString(),
        expiresAt: new Date(created + 20 * MINUTE).toISOString(),
      }),
    );

    expect(useLearnerStore.getState().serverTimeOffsetMs).toBe(0);
    expect(timerReadout()).toBe("00:10:00");
  });

  it("says an unsubmitted attempt past its deadline is over, with no results to show", async () => {
    mockStatus.mockResolvedValue(freshStatus({ acceptingSubmissions: false }));

    await renderPage(stalePayload());

    expect(
      screen.getByText("This attempt's time limit has passed."),
    ).toBeInTheDocument();
    expect(screen.queryByText("View results")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Back to assignment"));
    expect(mockPush).toHaveBeenCalledWith("/learner/771");
  });

  it("closes the page when it comes back from the back/forward cache onto a closed attempt", async () => {
    const created = NOW - 10 * MINUTE;
    mockStatus.mockResolvedValue(
      freshStatus({ expiresAt: new Date(created + 20 * MINUTE).toISOString() }),
    );
    await renderPage(
      stalePayload({
        createdAt: new Date(created).toISOString(),
        serverNow: new Date(created).toISOString(),
        expiresAt: new Date(created + 20 * MINUTE).toISOString(),
      }),
    );
    expect(screen.getByTestId("editable-attempt")).toBeInTheDocument();

    mockStatus.mockResolvedValue(closedAtTimeLimit());
    await act(async () => {
      const event = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("This attempt is closed")).toBeInTheDocument();
    expect(screen.queryByTestId("editable-attempt")).not.toBeInTheDocument();
  });

  it("tells the learner in their own language", async () => {
    localStorage.setItem("ui-language", "es");
    mockStatus.mockResolvedValue(closedAtTimeLimit());

    await renderPage(stalePayload());
    await flush();

    expect(screen.getByText("Este intento está cerrado")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Este intento ya se cerró al alcanzar su límite de tiempo.",
      ),
    ).toBeInTheDocument();
  });
});
