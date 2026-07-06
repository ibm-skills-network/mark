jest.mock("@/app/Helpers/getStoredDataFromLocal", () => ({
  getStoredData: jest.fn(),
}));

jest.mock("@/app/Helpers/processQuestionsBeforePublish", () => ({
  processQuestions: jest.fn((qs: unknown[]) => qs),
}));

import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import { processQuestions } from "@/app/Helpers/processQuestionsBeforePublish";
import {
  readAuthorPreviewPayload,
  buildAuthorPreviewPayload,
} from "../authorPreview";
import type { Assignment } from "@/config/types";

const mockGetStoredData = getStoredData as jest.MockedFunction<
  typeof getStoredData
>;
const mockProcessQuestions = processQuestions as jest.MockedFunction<
  typeof processQuestions
>;

const VALID_DETAILS = { id: 1, name: "Assignment One" };
const VALID_QUESTIONS = [{ id: 10, question: "Q1" }];

describe("readAuthorPreviewPayload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when assignmentConfig is absent", () => {
    mockGetStoredData
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(VALID_QUESTIONS);
    expect(readAuthorPreviewPayload(1)).toBeNull();
  });

  it("returns null when assignment id does not match", () => {
    mockGetStoredData
      .mockReturnValueOnce({ id: 2, name: "Other" })
      .mockReturnValueOnce(VALID_QUESTIONS);
    expect(readAuthorPreviewPayload(1)).toBeNull();
  });

  it("returns null when assignment name is an empty string", () => {
    mockGetStoredData
      .mockReturnValueOnce({ id: 1, name: "" })
      .mockReturnValueOnce(VALID_QUESTIONS);
    expect(readAuthorPreviewPayload(1)).toBeNull();
  });

  it("returns payload even when questions array is empty (no-question assignments)", () => {
    mockGetStoredData
      .mockReturnValueOnce(VALID_DETAILS)
      .mockReturnValueOnce([]);
    expect(readAuthorPreviewPayload(1)).toEqual({
      assignmentDetails: VALID_DETAILS,
      questions: [],
    });
  });

  it("returns null when questions is not an array", () => {
    mockGetStoredData
      .mockReturnValueOnce(VALID_DETAILS)
      .mockReturnValueOnce(null);
    expect(readAuthorPreviewPayload(1)).toBeNull();
  });

  it("returns payload when id matches and questions are present", () => {
    mockGetStoredData
      .mockReturnValueOnce(VALID_DETAILS)
      .mockReturnValueOnce(VALID_QUESTIONS);
    const result = readAuthorPreviewPayload(1);
    expect(result).toEqual({
      assignmentDetails: VALID_DETAILS,
      questions: VALID_QUESTIONS,
    });
  });
});

describe("buildAuthorPreviewPayload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessQuestions.mockImplementation((qs) => qs as any);
  });

  const baseAssignment = {
    id: 5,
    name: "Test",
    graded: true,
    passingGrade: 60,
    questionOrder: [1, 2],
    questions: [],
    published: false,
    showQuestions: true,
    showAssignmentScore: false,
    showQuestionScore: true,
    showSubmissionFeedback: true,
    correctAnswerVisibility: "ALWAYS",
    questionControls: null,
    updatedAt: "2024-01-01T00:00:00Z",
  } as unknown as Assignment;

  it("maps core assignment fields into assignmentDetails", () => {
    const result = buildAuthorPreviewPayload(baseAssignment);
    expect(result.assignmentDetails.id).toBe(5);
    expect(result.assignmentDetails.name).toBe("Test");
    expect(result.assignmentDetails.passingGrade).toBe(60);
    expect(result.assignmentDetails.questionOrder).toEqual([1, 2]);
    expect(result.assignmentDetails.published).toBe(false);
  });

  it("maps feedback visibility fields", () => {
    const result = buildAuthorPreviewPayload(baseAssignment);
    expect(result.assignmentDetails.showQuestions).toBe(true);
    expect(result.assignmentDetails.showAssignmentScore).toBe(false);
    expect(result.assignmentDetails.showQuestionScore).toBe(true);
    expect(result.assignmentDetails.showSubmissionFeedback).toBe(true);
    expect(result.assignmentDetails.correctAnswerVisibility).toBe("ALWAYS");
  });

  it("calls processQuestions on assignment.questions", () => {
    const questions = [{ id: 1, type: "TEXT" }] as any;
    buildAuthorPreviewPayload({ ...baseAssignment, questions });
    expect(mockProcessQuestions).toHaveBeenCalledWith(questions);
  });

  it("returns processed questions in the payload", () => {
    const raw = [{ id: 1 }] as any;
    const processed = [{ id: 1, processed: true }] as any;
    mockProcessQuestions.mockReturnValueOnce(processed);
    const result = buildAuthorPreviewPayload({
      ...baseAssignment,
      questions: raw,
    });
    expect(result.questions).toEqual(processed);
  });

  it("handles null questions gracefully", () => {
    const result = buildAuthorPreviewPayload({
      ...baseAssignment,
      questions: null as any,
    });
    expect(mockProcessQuestions).toHaveBeenCalledWith([]);
  });
});
