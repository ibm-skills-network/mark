/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LearnerAttemptsTable } from "../LearnerAttemptsTable";
import type { LearnerAttemptSummary } from "@/lib/shared";
import * as shared from "@/lib/shared";

jest.mock("@/lib/shared", () => ({
  ...jest.requireActual("@/lib/shared"),
  getLearnerAttempts: jest.fn(),
  forcePassAttempt: jest.fn(),
  deleteLearnerAttempt: jest.fn(),
}));

const attempt = (
  over: Partial<LearnerAttemptSummary> = {},
): LearnerAttemptSummary => ({
  id: 7,
  assignmentId: 42,
  assignmentName: "Intro to Mark",
  userId: "learner-1",
  submitted: true,
  grade: 0.2,
  passingGrade: 50,
  gradingStatus: "COMPLETED",
  createdAt: "2026-06-04T10:00:00.000Z",
  expiresAt: null,
  ...over,
});

// Wrap async clicks in act because the test setup disables MessageChannel scheduling.
const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

const searchFor = async (id = "learner-1") => {
  fireEvent.change(screen.getByPlaceholderText(/user ID or email/i), {
    target: { value: id },
  });
  await click("Search");
};

beforeEach(() => jest.clearAllMocks());

it("looks the learner up by the typed id and lists their attempts", async () => {
  (shared.getLearnerAttempts as jest.Mock).mockResolvedValue([attempt()]);

  render(<LearnerAttemptsTable sessionToken="tok" />);
  await searchFor("Learner-1");

  expect(shared.getLearnerAttempts).toHaveBeenCalledWith("tok", "Learner-1");
  expect(screen.getByText("Intro to Mark")).toBeInTheDocument();
  expect(screen.getByText("20%")).toBeInTheDocument();
});

it("reports an empty result rather than looking like it is still loading", async () => {
  (shared.getLearnerAttempts as jest.Mock).mockResolvedValue([]);

  render(<LearnerAttemptsTable sessionToken="tok" />);
  await searchFor("nobody");

  expect(screen.getByText("No attempts found for nobody")).toBeInTheDocument();
});

it("hides Pass for an already-passing attempt", async () => {
  // Verify the exact passing-grade cutoff is treated as passing.
  (shared.getLearnerAttempts as jest.Mock).mockResolvedValue([
    attempt({ grade: 0.5 }),
  ]);

  render(<LearnerAttemptsTable sessionToken="tok" />);
  await searchFor();

  expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
  expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
});

it("requires a confirm before passing, then shows the new grade", async () => {
  (shared.getLearnerAttempts as jest.Mock).mockResolvedValue([attempt()]);
  (shared.forcePassAttempt as jest.Mock).mockResolvedValue({ success: true });

  render(<LearnerAttemptsTable sessionToken="tok" />);
  await searchFor();

  await click("Pass");
  expect(shared.forcePassAttempt).not.toHaveBeenCalled();

  await click("Confirm");
  expect(shared.forcePassAttempt).toHaveBeenCalledWith("tok", 7);
  expect(screen.getByText("100%")).toBeInTheDocument();
});

it("requires a confirm before deleting, then drops the row", async () => {
  (shared.getLearnerAttempts as jest.Mock).mockResolvedValue([attempt()]);
  (shared.deleteLearnerAttempt as jest.Mock).mockResolvedValue({
    success: true,
    attemptId: 7,
  });

  render(<LearnerAttemptsTable sessionToken="tok" />);
  await searchFor();

  await click("Delete");
  expect(shared.deleteLearnerAttempt).not.toHaveBeenCalled();

  await click("Confirm");
  expect(shared.deleteLearnerAttempt).toHaveBeenCalledWith("tok", 7);
  expect(screen.queryByText("Intro to Mark")).toBeNull();
});

it("keeps the row and surfaces the error when the delete fails", async () => {
  (shared.getLearnerAttempts as jest.Mock).mockResolvedValue([attempt()]);
  (shared.deleteLearnerAttempt as jest.Mock).mockRejectedValue(
    new Error("attempt is locked"),
  );

  render(<LearnerAttemptsTable sessionToken="tok" />);
  await searchFor();

  await click("Delete");
  await click("Confirm");

  expect(screen.getByText("attempt is locked")).toBeInTheDocument();
  expect(screen.getByText("Intro to Mark")).toBeInTheDocument();
});

it("does not search on an empty box", () => {
  render(<LearnerAttemptsTable sessionToken="tok" />);

  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  expect(shared.getLearnerAttempts).not.toHaveBeenCalled();
});
