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
const mockSearchParams = jest.fn(() => new URLSearchParams());
jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams(),
  usePathname: () => "/learner/3428/questions",
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: jest.fn(),
  }),
  useSearchParams: () => mockSearchParams(),
}));

// --- backend: submitAssignment is the call whose first arg must be the URL id ---
const mockSubmitAssignment = jest.fn();
const mockGetAttempt = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/talkToBackend", () => ({
  submitAssignment: (...args: unknown[]) => mockSubmitAssignment(...args),
  getSupportedLanguages: jest.fn().mockResolvedValue([]),
  getUser: jest.fn().mockResolvedValue({ role: "learner", returnUrl: "" }),
  getAttempt: (...args: unknown[]) => mockGetAttempt(...args),
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
    isUploadingFiles: false,
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
    mockSearchParams.mockImplementation(() => new URLSearchParams());
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

describe("LearnerHeader post-submit language reset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("does not re-navigate the questions route after submit when the UI language is not English", async () => {
    // Prod signature (Sep 2026): for learners on ?uiLang=<non-en>, the reset
    // after submit turned the store language into "en", the uiLang URL sync
    // dropped the param with router.replace(<questions path>), and the server
    // layout for that route created a fresh attempt — bouncing the learner
    // off their results. English learners have no uiLang param, so nothing
    // fired for them.
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    mockSearchParams.mockImplementation(() => new URLSearchParams("uiLang=it"));
    seedLearnerState(null);
    useLearnerStore.setState({ userPreferedLanguage: "it" });
    mockSubmitAssignment.mockResolvedValue({
      id: 999,
      grade: 0.9,
      totalPointsEarned: 9,
      totalPossiblePoints: 10,
      passed: true,
      showSubmissionFeedback: true,
      feedbacksForQuestions: [],
    });

    jest.useFakeTimers();
    try {
      render(<LearnerHeader />);
      await act(async () => {
        window.dispatchEvent(new Event("triggerAssignmentSubmission"));
      });
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });

      expect(mockPush).toHaveBeenCalledWith("/learner/3428/successPage/999");
      const questionsRouteNavigations = mockReplace.mock.calls.filter(([url]) =>
        String(url).includes("/questions"),
      );
      expect(questionsRouteNavigations).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("LearnerHeader duplicate-submit conflict", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockSearchParams.mockImplementation(() => new URLSearchParams());
  });

  it("sends the learner to their results when the API reports the attempt was already submitted", async () => {
    // A retried PATCH (proxy timeout, lost stream) lands on an attempt that is
    // already graded. The learner must land on those results, not be told
    // grading is down and that nothing was submitted.
    const { AttemptAlreadySubmittedError } =
      jest.requireActual("@/lib/learner");
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    seedLearnerState(null);
    mockSubmitAssignment.mockRejectedValue(
      new AttemptAlreadySubmittedError(999),
    );

    render(<LearnerHeader />);
    await triggerSubmit();

    expect(mockPush).toHaveBeenCalledWith("/learner/3428/successPage/999");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId("grading-modal")).not.toBeInTheDocument();
  });
});

// The attempt response now carries only the language it was requested in, so
// the page has to notice when the server sent a language the learner did not
// ask for — otherwise a learner reaching /questions without a `lang` parameter
// silently reads the whole assignment in English.
describe("LearnerHeader content language reconciliation", () => {
  const questionInEnglishOnly = {
    id: 1,
    status: "unedited",
    question: "Pick one",
    translations: { en: { translatedText: "Pick one" } },
  } as unknown as QuestionStore;

  const questionInSpanish = {
    ...questionInEnglishOnly,
    translations: {
      en: { translatedText: "Pick one" },
      es: { translatedText: "Elige una" },
    },
  } as unknown as QuestionStore;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    mockSearchParams.mockImplementation(() => new URLSearchParams());
    mockGetAttempt.mockResolvedValue({ questions: [questionInSpanish] });
  });

  it("refetches the attempt when the payload lacks the learner's language", async () => {
    useLearnerStore.setState({
      questions: [questionInEnglishOnly],
      activeAttemptId: 999,
      userPreferedLanguage: "es",
    });
    useLearnerOverviewStore.setState({ assignmentId: 3428 });

    await act(async () => {
      render(<LearnerHeader />);
    });

    expect(mockGetAttempt).toHaveBeenCalledWith(3428, 999, undefined, "es");
    expect(
      useLearnerStore.getState().questions[0].translations?.es,
    ).toBeDefined();
  });

  it("does not refetch when the payload already has the language", async () => {
    useLearnerStore.setState({
      questions: [questionInSpanish],
      activeAttemptId: 999,
      userPreferedLanguage: "es",
    });
    useLearnerOverviewStore.setState({ assignmentId: 3428 });

    await act(async () => {
      render(<LearnerHeader />);
    });

    expect(mockGetAttempt).not.toHaveBeenCalled();
  });

  it("does not refetch for an English learner", async () => {
    useLearnerStore.setState({
      questions: [questionInEnglishOnly],
      activeAttemptId: 999,
      userPreferedLanguage: "en",
    });
    useLearnerOverviewStore.setState({ assignmentId: 3428 });

    await act(async () => {
      render(<LearnerHeader />);
    });

    expect(mockGetAttempt).not.toHaveBeenCalled();
  });

  // Translations are generated lazily, so a language may genuinely have none
  // yet. Retrying on every render would put the page in a fetch loop.
  it("asks once for a language that has no translations at all", async () => {
    mockGetAttempt.mockResolvedValue({ questions: [questionInEnglishOnly] });
    useLearnerStore.setState({
      questions: [questionInEnglishOnly],
      activeAttemptId: 999,
      userPreferedLanguage: "es",
    });
    useLearnerOverviewStore.setState({ assignmentId: 3428 });

    const { rerender } = render(<LearnerHeader />);
    await act(async () => {
      rerender(<LearnerHeader />);
    });
    await act(async () => {
      rerender(<LearnerHeader />);
    });

    expect(mockGetAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("LearnerHeader submit gating", () => {
  // The header's own Submit button is disabled by getSubmitButtonStatus, but
  // the in-page submit control reaches the same handler through a window
  // event. The gate has to live on the handler or that route skips every check.
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockSearchParams.mockImplementation(() => new URLSearchParams());
    mockUseParams.mockReturnValue({ assignmentId: "3428" });
    mockSubmitAssignment.mockResolvedValue(undefined);
  });

  it("refuses to submit while a file upload is still running", async () => {
    // Submitting mid-upload posts the attempt without the file the learner is
    // waiting on; it grades as an empty answer.
    seedLearnerState(null);
    useLearnerStore.setState({ isUploadingFiles: true });

    render(<LearnerHeader />);
    await triggerSubmit();

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/file upload in progress/i),
    );
  });

  it("refuses to submit when no question has been answered", async () => {
    seedLearnerState(null);
    useLearnerStore.setState({
      questions: [{ id: 1, status: "unedited" } as unknown as QuestionStore],
    });

    render(<LearnerHeader />);
    await triggerSubmit();

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/no questions have been answered/i),
    );
  });

  it("refuses to submit an answer whose URL is not valid", async () => {
    seedLearnerState(null);
    useLearnerStore.setState({
      questions: [
        {
          id: 1,
          status: "edited",
          learnerUrlResponse: "not a url",
        } as unknown as QuestionStore,
      ],
    });

    render(<LearnerHeader />);
    await triggerSubmit();

    expect(mockSubmitAssignment).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/doesn't look like a web address|invalid url/i),
    );
  });

  it("still submits once everything the header checks is satisfied", async () => {
    seedLearnerState(null);

    render(<LearnerHeader />);
    await triggerSubmit();

    expect(mockSubmitAssignment).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringMatching(
        /file upload in progress|no questions have been answered|web address|invalid url/i,
      ),
    );
  });
});
