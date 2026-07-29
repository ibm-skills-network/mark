/**
 * @jest-environment jsdom
 */

import React, { createElement } from "react";
import { render, screen, act } from "@testing-library/react";
import { toast } from "sonner";
import type { QuestionStore } from "@/config/types";
import {
  useAssignmentDetails,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import LearnerHeader from "../Header";

// --- next/navigation: useParams is the source of truth we are locking in ---
const mockUseParams = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams(),
  usePathname: () => "/learner/3428/questions",
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: jest.fn(),
  }),
  useSearchParams: () => ({ get: () => null, toString: () => "" }),
}));

// --- backend: submitAssignment is the call whose first arg must be the URL id ---
const mockSubmitAssignment = jest.fn();
jest.mock("@/lib/talkToBackend", () => ({
  submitAssignment: (...args: unknown[]) => mockSubmitAssignment(...args),
  getSupportedLanguages: jest.fn().mockResolvedValue([]),
  getUser: jest.fn().mockResolvedValue({ role: "learner", returnUrl: "" }),
}));

jest.mock("@/lib/learner", () => ({
  ...jest.requireActual("@/lib/learner"),
  subscribeToGradingNotification: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    warning: jest.fn(),
    message: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock("@/app/chatbot/store/useMarkChatStore", () => ({
  useMarkChatStore: (selector: (s: { setUserRole: () => void }) => unknown) =>
    selector({ setUserRole: jest.fn() }),
}));

// --- presentational children stubbed to keep the render tree light ---
// The status is surfaced as a data attribute (not just isOpen) so tests can
// prove the widened "stalled"/"disconnected" statuses actually reach this
// component through Header's onProgress callsite, rather than only checking
// that the modal itself renders them correctly in isolation.
jest.mock("../GradingProgressModal", () => ({
  __esModule: true,
  default: (props: { isOpen?: boolean; progressData?: { status?: string } }) =>
    props.isOpen
      ? createElement("div", {
          "data-testid": "grading-modal",
          "data-status": props.progressData?.status,
        })
      : null,
}));
jest.mock("@/components/Button", () => ({
  __esModule: true,
  default: (props: {
    onClick?: () => void;
    disabled?: boolean;
    children?: React.ReactNode;
  }) =>
    createElement(
      "button",
      { onClick: props.onClick, disabled: props.disabled },
      props.children,
    ),
}));
jest.mock("@/components/Dropdown", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/svgs/Spinner", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/WarningAlert", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/MarkChatToggleButton", () => ({
  MarkChatToggleButton: () => null,
}));
jest.mock("@components/SNIcon", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@components/Title", () => ({
  __esModule: true,
  default: () => null,
}));

const answeredQuestion = {
  id: 1,
  status: "edited",
  learnerTextResponse: "my answer",
} as unknown as QuestionStore;

function seedLearnerState(assignmentIdInStore: number | null) {
  useLearnerStore.setState({
    questions: [answeredQuestion],
    activeAttemptId: 999,
    userPreferedLanguage: null,
  });
  useLearnerOverviewStore.setState({ assignmentId: assignmentIdInStore });
  useAssignmentDetails.setState({ assignmentDetails: null });
}

async function triggerSubmit() {
  // The submit button onClick and this window event both funnel into the
  // same handler; the event is the deterministic trigger for a unit test.
  await act(async () => {
    window.dispatchEvent(new Event("triggerAssignmentSubmission"));
  });
}

describe("LearnerHeader submit path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("submits with the assignmentId from the URL, not the (null) store value", async () => {
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    mockSubmitAssignment.mockResolvedValue(undefined);
    seedLearnerState(null);

    render(<LearnerHeader />);
    await triggerSubmit();

    expect(mockSubmitAssignment).toHaveBeenCalled();
    expect(mockSubmitAssignment.mock.calls[0][0]).toBe(3428);
  });

  it("closes the grading modal and toasts when the URL assignmentId is missing", async () => {
    mockUseParams.mockReturnValue({ assignmentId: undefined });
    mockSubmitAssignment.mockResolvedValue(undefined);
    seedLearnerState(null);

    render(<LearnerHeader />);
    await triggerSubmit();

    // The bug: the modal is opened before the guard and never closed on bail.
    expect(screen.queryByTestId("grading-modal")).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
    expect(mockSubmitAssignment).not.toHaveBeenCalled();
  });

  it("passes the widened stalled/disconnected statuses through to the modal untouched", async () => {
    // Guards against a regression to the old bridge that collapsed
    // stalled -> processing and disconnected -> failed at this callsite: if
    // that mapping ever comes back, the modal would never see its dedicated
    // states even though GradingProgressModal itself renders them correctly.
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    seedLearnerState(null);

    let capturedOnProgress:
      | ((
          status: string,
          progress: number,
          message: string,
          metadata?: unknown,
        ) => void)
      | undefined;
    mockSubmitAssignment.mockImplementation(
      (...args: unknown[]) =>
        new Promise(() => {
          capturedOnProgress = args[7] as typeof capturedOnProgress;
        }),
    );

    render(<LearnerHeader />);
    await triggerSubmit();

    act(() => {
      capturedOnProgress?.("stalled", 40, "still going");
    });
    expect(screen.getByTestId("grading-modal")).toHaveAttribute(
      "data-status",
      "stalled",
    );

    act(() => {
      capturedOnProgress?.("disconnected", 0, "lost contact");
    });
    expect(screen.getByTestId("grading-modal")).toHaveAttribute(
      "data-status",
      "disconnected",
    );
  });

  it("keeps the grading modal open showing disconnected when the grading stream is lost", async () => {
    const { isGradingStreamLostError } = jest.requireActual("@/lib/learner");
    expect(isGradingStreamLostError).toBeDefined();

    class GradingStreamLostError extends Error {
      constructor() {
        super("We lost contact with the grading service.");
        this.name = "GradingStreamLostError";
      }
    }

    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    seedLearnerState(null);

    // Mirrors the real watchdog (lib/learner.ts's handleStreamLost): it
    // reports the terminal "disconnected" frame through onProgress before
    // rejecting with GradingStreamLostError. Capturing the real onProgress
    // closure and driving it the same way proves the full chain — rejection
    // sets the status, and the modal stays up showing it — rather than only
    // asserting the modal is still mounted.
    mockSubmitAssignment.mockImplementation((...args: unknown[]) => {
      const onProgress = args[7] as (
        status: string,
        progress: number,
        message: string,
      ) => void;
      onProgress(
        "disconnected",
        0,
        "We lost contact with the grading service. Your answers were submitted — check your results in a moment.",
      );
      return Promise.reject(new GradingStreamLostError());
    });

    jest.useFakeTimers();
    try {
      render(<LearnerHeader />);

      await act(async () => {
        window.dispatchEvent(new Event("triggerAssignmentSubmission"));
      });
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      const modal = screen.getByTestId("grading-modal");
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute("data-status", "disconnected");
    } finally {
      jest.useRealTimers();
    }
  });
});
