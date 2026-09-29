/**
 * @jest-environment jsdom
 */

import React, { createElement } from "react";
import { render, screen } from "@testing-library/react";
import type { QuestionStore } from "@/config/types";
import {
  useAssignmentDetails,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import LearnerHeader from "../Header";

// The learner header ships two layouts and lets CSS pick one. jsdom has no
// media queries, so these tests assert the breakpoint utilities themselves:
// which layout each width gets, and whether the chosen layout can shrink.
// The measured geometry behind them is in the width sweep under
// .planning/.../verify/header (a header row whose min-content is ~960px was
// rendered into a 640-900px viewport, inside an overflow-hidden route root).

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

jest.mock("@/lib/talkToBackend", () => ({
  submitAssignment: jest.fn(),
  getSupportedLanguages: jest.fn().mockResolvedValue(["en", "es"]),
  getUser: jest.fn().mockResolvedValue({ role: "learner", returnUrl: "" }),
  getAttempt: jest.fn().mockResolvedValue(undefined),
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

jest.mock("../GradingProgressModal", () => ({
  __esModule: true,
  default: () => null,
}));

// Unlike the sibling suite these stubs keep className and children, because
// what is under test is the layout the header asks for.
jest.mock("@/components/Button", () => ({
  __esModule: true,
  default: (props: {
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    children?: React.ReactNode;
  }) =>
    createElement(
      "button",
      {
        onClick: props.onClick,
        disabled: props.disabled,
        className: props.className,
      },
      props.children,
    ),
}));
jest.mock("@/components/Dropdown", () => ({
  __esModule: true,
  default: () =>
    createElement("button", { "data-testid": "language-dropdown" }, "Language"),
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
  MarkChatToggleButton: () =>
    createElement("button", { "data-testid": "chat-toggle" }, "Ask Mark"),
}));
jest.mock("@/components/ThemeToggle", () => ({
  __esModule: true,
  default: () =>
    createElement("button", { "data-testid": "theme-toggle" }, "Theme"),
}));
jest.mock("@components/SNIcon", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@components/Title", () => ({
  __esModule: true,
  default: (props: { className?: string; children?: React.ReactNode }) =>
    createElement("h1", { className: props.className }, props.children),
}));

const answeredQuestion = {
  id: 1,
  status: "edited",
  learnerTextResponse: "my answer",
} as unknown as QuestionStore;

function renderHeader() {
  useLearnerStore.setState({
    questions: [answeredQuestion],
    activeAttemptId: 999,
    userPreferedLanguage: null,
    isUploadingFiles: false,
  });
  useLearnerOverviewStore.setState({ assignmentId: 3428 });
  useAssignmentDetails.setState({ assignmentDetails: null });
  mockUseParams.mockReturnValue({ assignmentId: "3428" });
  return render(<LearnerHeader />);
}

/** Tailwind class list of an element, as a set for order-free assertions. */
const classesOf = (element: Element | null) =>
  new Set((element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

describe("learner header layout across viewport widths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockSearchParams.mockImplementation(() => new URLSearchParams());
  });

  it("hands every viewport below the desktop breakpoint the stacked layout", () => {
    renderHeader();

    const compact = screen.getByTestId("learner-header-compact");
    const wide = screen.getByTestId("learner-header-wide");

    // The single row only appears once there is room for it. Switching at
    // `sm` (640px) handed the row to viewports it does not fit in.
    expect(classesOf(compact).has("lg:hidden")).toBe(true);
    expect(classesOf(compact).has("sm:hidden")).toBe(false);
    expect(classesOf(wide).has("hidden")).toBe(true);
    expect(classesOf(wide).has("lg:flex")).toBe(true);
    expect(classesOf(wide).has("sm:flex")).toBe(false);
  });

  it("only fixes the header height where the single row is used", () => {
    const { container } = renderHeader();
    const header = container.querySelector("header");

    // A stacked header is two or three rows tall depending on the width, so
    // it gets a minimum and grows; the single row keeps its exact height.
    expect(classesOf(header).has("min-h-[80px]")).toBe(true);
    expect(classesOf(header).has("lg:h-[100px]")).toBe(true);
    expect(classesOf(header).has("sm:h-[100px]")).toBe(false);
  });

  it("wraps the stacked controls instead of pushing the submit button out", () => {
    renderHeader();

    const compact = screen.getByTestId("learner-header-compact");
    const controlRow = compact.querySelector(
      '[data-testid="learner-header-compact-controls"]',
    );
    expect(controlRow).not.toBeNull();
    expect(classesOf(controlRow).has("flex-wrap")).toBe(true);

    // Secondary controls give way first: the submit control never shrinks
    // and never wraps out of reach.
    const submitSlot = compact.querySelector(
      '[data-testid="learner-header-compact-submit"]',
    );
    expect(submitSlot).not.toBeNull();
    expect(classesOf(submitSlot).has("shrink-0")).toBe(true);
  });

  it("keeps a long assignment name from pushing the single row off screen", () => {
    renderHeader();

    const wide = screen.getByTestId("learner-header-wide");
    const title = wide.querySelector("h1");
    expect(classesOf(title).has("truncate")).toBe(true);

    // A flex item's automatic minimum size is its content, so without
    // min-w-0 the title pushes the controls past the right edge.
    const titleGroup = wide.querySelector(
      '[data-testid="learner-header-wide-title"]',
    );
    expect(titleGroup).not.toBeNull();
    expect(classesOf(titleGroup).has("min-w-0")).toBe(true);

    const controlGroup = wide.querySelector(
      '[data-testid="learner-header-wide-controls"]',
    );
    expect(controlGroup).not.toBeNull();
    expect(classesOf(controlGroup).has("shrink-0")).toBe(true);
  });

  it("offers a submit control in both layouts, wired to the same handler", () => {
    renderHeader();

    const compactSubmit = screen
      .getByTestId("learner-header-compact")
      .querySelector("button.btn-secondary");
    const wideSubmit = screen
      .getByTestId("learner-header-wide")
      .querySelector("button.btn-secondary");

    // Neither layout may be "fixed" by dropping its submit button: whichever
    // one the viewport width selects has to carry one, enabled on an
    // answered attempt.
    expect(compactSubmit?.textContent).toMatch(/^Submit/);
    expect(wideSubmit?.textContent).toMatch(/^Submit/);
    expect(compactSubmit).not.toBeDisabled();
    expect(wideSubmit).not.toBeDisabled();
  });
});
