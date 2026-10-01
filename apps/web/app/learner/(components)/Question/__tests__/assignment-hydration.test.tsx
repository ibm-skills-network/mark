/**
 * @jest-environment jsdom
 */

import { render, waitFor } from "@testing-library/react";
import type { AssignmentAttemptWithQuestions } from "@/config/types";
import { getAssignment } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import QuestionPage from "../index";

jest.mock("@/lib/talkToBackend", () => ({
  getAssignment: jest.fn(),
  getUser: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/learner/42/questions",
}));

// The page's children are irrelevant to how often the assignment is fetched.
jest.mock("../Overview", () => ({ __esModule: true, default: () => null }));
jest.mock("../QuestionContainer", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../TipsView", () => ({ __esModule: true, default: () => null }));
jest.mock("../../SecurityMonitor", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../VersionMismatchBanner", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/Loading", () => ({
  __esModule: true,
  default: () => null,
}));

const getAssignmentMock = getAssignment as jest.Mock;

// An attempt that carries neither `assignmentDetails` nor `name` is the shape
// that forces the page to fetch the assignment itself.
const attemptWithoutDetails = {
  id: 500,
  assignmentId: 42,
  questions: [
    {
      id: 7,
      type: "SINGLE_CORRECT",
      totalPoints: 1,
      question: "Pick one",
      choices: [],
    },
  ],
  passingGrade: 50,
  showSubmissionFeedback: true,
  showAssignmentScore: true,
  showQuestions: true,
  showQuestionScore: true,
} as unknown as AssignmentAttemptWithQuestions;

describe("QuestionPage assignment hydration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAssignmentDetails.setState({ assignmentDetails: null });
    useLearnerStore.setState({ questions: [] });
    getAssignmentMock.mockResolvedValue({
      id: 42,
      name: "Quiz",
      passingGrade: 50,
    });
  });

  // Storing the fetched assignment re-ran the effect that fetched it, so one
  // page load paid for the assignment payload twice — half a megabyte each on
  // a large assignment, on top of the attempt payload.
  it("fetches the assignment once per page load", async () => {
    render(<QuestionPage attempt={attemptWithoutDetails} assignmentId={42} />);

    await waitFor(() =>
      expect(useAssignmentDetails.getState().assignmentDetails).not.toBeNull(),
    );
    // Let any dependent effect re-run settle before counting.
    await waitFor(() => expect(getAssignmentMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(getAssignmentMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch at all when the attempt already describes the assignment", async () => {
    const attemptWithName = {
      ...attemptWithoutDetails,
      name: "Quiz",
    } as unknown as AssignmentAttemptWithQuestions;

    render(<QuestionPage attempt={attemptWithName} assignmentId={42} />);

    await waitFor(() =>
      expect(useAssignmentDetails.getState().assignmentDetails).not.toBeNull(),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(getAssignmentMock).not.toHaveBeenCalled();
  });
});
