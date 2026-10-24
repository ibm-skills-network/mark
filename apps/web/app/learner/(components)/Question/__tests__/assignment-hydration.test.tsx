/**
 * @jest-environment jsdom
 */

import { render, waitFor } from "@testing-library/react";
import type { AssignmentAttemptWithQuestions } from "@/config/types";
import { getAssignment } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import QuestionPage from "../index";

// The fresh status read is unavailable here, so these cases exercise the
// payload-clock fallback.
jest.mock("@/lib/attempt-submission-status", () => ({
  ...jest.requireActual("@/lib/attempt-submission-status"),
  getAttemptSubmissionStatus: jest.fn().mockResolvedValue({ ok: false }),
}));

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
    localStorage.clear();
    useLearnerStore.setState({ activeAttemptId: null });
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

  const savedAnswer = '<p class="ql-indent-1">old   saved answer</p>';
  const makeResponse = (id: number, questionId = 7, answer = savedAnswer) => ({
    id,
    questionId,
    assignmentAttemptId: 500,
    learnerResponse: JSON.stringify(answer),
    points: 0,
    feedback: [],
  });
  const textAttempt = {
    ...attemptWithoutDetails,
    name: "Quiz",
    questions: [
      {
        id: 7,
        type: "TEXT",
        question: "Write",
        totalPoints: 1,
        maxCharacters: 5,
      },
    ],
    questionResponses: [
      makeResponse(90),
      makeResponse(91, 8, "Other question"),
    ],
  } as AssignmentAttemptWithQuestions;

  it("restores attempt-level saved HTML in a fresh session, including answers over the limit", async () => {
    render(<QuestionPage attempt={textAttempt} assignmentId={42} />);
    await waitFor(() =>
      expect(useLearnerStore.getState().questions[0]?.learnerTextResponse).toBe(
        savedAnswer,
      ),
    );
    expect(useLearnerStore.getState().questions[0].status).toBe("unedited");
    expect(textAttempt.questions[0].questionResponses).toBeUndefined();
  });

  it("uses the newest response across nested and attempt-level responses", async () => {
    const attempt = {
      ...textAttempt,
      questions: [
        {
          ...textAttempt.questions[0],
          questionResponses: [makeResponse(100, 7, "Newest nested answer")],
        },
      ],
    };
    render(<QuestionPage attempt={attempt} assignmentId={42} />);
    await waitFor(() =>
      expect(useLearnerStore.getState().questions[0]?.learnerTextResponse).toBe(
        "Newest nested answer",
      ),
    );
  });

  it.each(["Unsaved draft", ""])(
    "preserves a local answer %j for the same attempt",
    async (draft) => {
      useLearnerStore.setState({
        activeAttemptId: 500,
        questions: [
          {
            ...textAttempt.questions[0],
            learnerTextResponse: draft,
            status: "edited",
          },
        ],
      });
      render(<QuestionPage attempt={textAttempt} assignmentId={42} />);
      await waitFor(() =>
        expect(
          useLearnerStore.getState().questions[0]?.questionResponses,
        ).toHaveLength(1),
      );
      expect(useLearnerStore.getState().questions[0].learnerTextResponse).toBe(
        draft,
      );
    },
  );

  it("discards a different attempt's local answer before restoring the saved answer", async () => {
    useLearnerStore.setState({
      activeAttemptId: 499,
      questions: [
        {
          ...textAttempt.questions[0],
          learnerTextResponse: "Previous attempt",
        },
      ],
    });
    render(<QuestionPage attempt={textAttempt} assignmentId={42} />);
    await waitFor(() =>
      expect(useLearnerStore.getState().questions[0]?.learnerTextResponse).toBe(
        savedAnswer,
      ),
    );
  });

  it.each([
    ["SINGLE_CORRECT", "learnerChoices", ["B"], ["1"], []],
    ["TRUE_FALSE", "learnerAnswerChoice", true, true, false],
    [
      "URL",
      "learnerUrlResponse",
      "https://example.com",
      "https://example.com",
      "",
    ],
    [
      "UPLOAD",
      "learnerFileResponse",
      [{ filename: "answer.pdf", key: "42/u/7/answer.pdf", bucket: "b" }],
      [
        {
          filename: "answer.pdf",
          key: "42/u/7/answer.pdf",
          bucket: "b",
          content: "InCos",
        },
      ],
      [],
    ],
  ] as const)(
    "restores %s answers and preserves cleared local values",
    async (type, field, saved, restored, draft) => {
      const attempt = {
        ...textAttempt,
        questions: [
          {
            ...textAttempt.questions[0],
            type,
            choices: [
              { choice: "A", points: 0, isCorrect: false },
              { choice: "B", points: 1, isCorrect: true },
            ],
          },
        ],
        questionResponses: [
          { ...makeResponse(90), learnerResponse: JSON.stringify(saved) },
        ],
      } as AssignmentAttemptWithQuestions;
      const { unmount } = render(
        <QuestionPage attempt={attempt} assignmentId={42} />,
      );
      await waitFor(() =>
        expect(useLearnerStore.getState().questions[0]?.[field]).toEqual(
          restored,
        ),
      );
      unmount();
      useLearnerStore.setState({
        activeAttemptId: 500,
        questions: [{ ...attempt.questions[0], [field]: draft }],
      });
      render(<QuestionPage attempt={attempt} assignmentId={42} />);
      await waitFor(() =>
        expect(
          useLearnerStore.getState().questions[0]?.questionResponses,
        ).toHaveLength(1),
      );
      expect(useLearnerStore.getState().questions[0][field]).toEqual(draft);
    },
  );

  it("restores only uploaded-file references from an older client's draft", async () => {
    const saved = [
      {
        filename: "main.py",
        githubUrl: "https://github.com/o/r/blob/main/main.py",
        owner: "o",
        repo: "r",
        path: "main.py",
        content: "print('x')\n".repeat(100),
      },
      {
        filename: "report.pdf",
        key: "42/u/7/report.pdf",
        bucket: "learner-bucket",
        fileType: "application/pdf",
        content: "x".repeat(1000),
        imageAnalysisResult: { width: 1 },
      },
    ];
    const attempt = {
      ...textAttempt,
      questions: [{ ...textAttempt.questions[0], type: "UPLOAD" }],
      questionResponses: [
        { ...makeResponse(90), learnerResponse: JSON.stringify(saved) },
      ],
    } as AssignmentAttemptWithQuestions;

    render(<QuestionPage attempt={attempt} assignmentId={42} />);

    await waitFor(() =>
      expect(
        useLearnerStore.getState().questions[0]?.learnerFileResponse,
      ).toEqual([
        {
          filename: "report.pdf",
          key: "42/u/7/report.pdf",
          bucket: "learner-bucket",
          fileType: "application/pdf",
          content: "InCos",
        },
      ]),
    );
  });
});
