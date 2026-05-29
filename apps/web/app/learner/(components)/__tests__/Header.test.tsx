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
jest.mock("../GradingProgressModal", () => ({
  __esModule: true,
  default: (props: { isOpen?: boolean }) =>
    props.isOpen
      ? createElement("div", { "data-testid": "grading-modal" })
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
});
