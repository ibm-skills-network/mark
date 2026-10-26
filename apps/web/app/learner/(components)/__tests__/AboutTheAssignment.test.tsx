/**
 * @jest-environment jsdom
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import type { Assignment } from "@/config/types";
import { useLearnerOverviewStore, useLearnerStore } from "@/stores/learner";
import AboutTheAssignment from "../AboutTheAssignment";

jest.mock("next/navigation", () => ({
  usePathname: () => "/learner/42",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/talkToBackend", () => ({
  getSupportedLanguages: jest.fn(),
}));

jest.mock("@/components/rich-text/RichTextViewer", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="rich-text">{children}</div>
  ),
}));

jest.mock("@/components/promo/PromoBanner", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../AboutTheAssignment/BeginTheAssignmentButton", () => ({
  __esModule: true,
  default: () => null,
}));

const mockDropdown = jest.fn();
jest.mock("@/components/Dropdown", () => ({
  __esModule: true,
  default: (props: { items: unknown }) => {
    mockDropdown(props);
    return null;
  },
}));

jest.mock("@/components/Modal", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock("@/hooks/use-ui-translation", () => ({
  useUiTranslation: () => ({
    t: (text: string) => text,
    activeLanguage: "en",
  }),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const backend: { getSupportedLanguages: jest.Mock } = jest.requireMock(
  "@/lib/talkToBackend",
);

const baseAssignment = {
  id: 42,
  name: "Quiz",
  published: true,
  graded: true,
  numAttempts: -1,
  passingGrade: 50,
  allotedTimeMinutes: null,
  timeEstimateMinutes: 10,
} as unknown as Assignment;

const renderAbout = async (overrides: Record<string, unknown>) => {
  await act(async () => {
    render(
      <AboutTheAssignment
        assignment={{ ...baseAssignment, ...overrides }}
        attempts={[]}
        role="learner"
        assignmentId={42}
        fetchData={jest.fn()}
        lmsHost={undefined}
      />,
    );
  });
};

describe("AboutTheAssignment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    backend.getSupportedLanguages.mockResolvedValue(["en", "es"]);
    useLearnerStore.setState({ userPreferedLanguage: null });
    // Opens the language picker so the loaded language list is observable.
    useLearnerOverviewStore.setState({ languageModalTriggered: true });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders nothing for null text fields instead of the word null", async () => {
    await renderAbout({
      introduction: null,
      instructions: null,
      gradingCriteriaOverview: null,
    });

    expect(screen.queryByText(/\bnull\b/)).toBeNull();
    const [introduction] = screen.getAllByTestId("rich-text");
    expect(introduction?.textContent).toBe("");
  });

  it("still renders authored text", async () => {
    await renderAbout({
      introduction: "Welcome",
      instructions: "Answer everything",
      gradingCriteriaOverview: "Be correct",
    });

    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.getByText("Answer everything")).toBeTruthy();
    expect(screen.getByText("Be correct")).toBeTruthy();
  });

  it("falls back to English when the languages request is refused", async () => {
    backend.getSupportedLanguages.mockRejectedValue(
      new Error("Forbidden resource"),
    );

    await renderAbout({ introduction: "Welcome" });

    expect(backend.getSupportedLanguages).toHaveBeenCalledWith(42);
    const lastDropdownProps = mockDropdown.mock.calls.at(-1)?.[0] as
      | { items: { value: string }[] }
      | undefined;
    expect(lastDropdownProps?.items.map((item) => item.value)).toEqual(["en"]);
  });
});
