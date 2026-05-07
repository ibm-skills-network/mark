import { QuestionAuthorStore } from "@/config/types";
import { generateTempQuestionId } from "@/lib/utils";
import { normalizeGeneratedQuestionsForAuthorStore } from "../normalize";

jest.mock("@/lib/utils", () => ({
  generateTempQuestionId: jest.fn(),
}));

describe("normalizeGeneratedQuestionsForAuthorStore", () => {
  const mockGenerateTempQuestionId =
    generateTempQuestionId as jest.MockedFunction<
      typeof generateTempQuestionId
    >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes generated multiple-choice questions for author store", () => {
    mockGenerateTempQuestionId.mockReturnValue(9001);

    const generatedQuestions: QuestionAuthorStore[] = [
      {
        id: 1,
        assignmentId: 10,
        type: "SINGLE_CORRECT",
        question: "Which option is correct?",
        totalPoints: 0,
        choices: [
          { choice: "A", isCorrect: true, points: 1 },
          { choice: "B", isCorrect: false, points: 0 },
        ],
        scoring: {
          type: "CRITERIA_BASED",
          criteria: [
            { id: 1, points: 1, description: "Accuracy" },
            { id: 2, points: 0, description: "Incorrect" },
          ],
        },
      },
    ];

    const normalized = normalizeGeneratedQuestionsForAuthorStore(
      generatedQuestions,
      42,
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe(9001);
    expect(normalized[0].assignmentId).toBe(42);
    expect(normalized[0].alreadyInBackend).toBe(false);
    expect(normalized[0].randomizedChoices).toBe(true);
    expect((normalized[0].choices as any)[0].id).toBe(0);
    expect((normalized[0].choices as any)[1].id).toBe(1);
    expect(normalized[0].totalPoints).toBe(1);
    expect(normalized[0].scoring).toBeNull();
  });

  it("uses criteria max points for text questions and keeps rubric scoring", () => {
    mockGenerateTempQuestionId.mockReturnValue(9002);

    const generatedQuestions: QuestionAuthorStore[] = [
      {
        id: 2,
        assignmentId: 10,
        type: "TEXT",
        question: "Explain photosynthesis.",
        totalPoints: 0,
        scoring: {
          type: "CRITERIA_BASED",
          criteria: [
            { id: 1, points: 3, description: "Core concept" },
            { id: 2, points: 7, description: "Depth" },
          ],
          rubrics: [
            {
              rubricQuestion: "Quality",
              criteria: [{ id: 1, points: 7, description: "Complete answer" }],
            },
          ],
        },
      },
    ];

    const normalized = normalizeGeneratedQuestionsForAuthorStore(
      generatedQuestions,
      84,
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe(9002);
    expect(normalized[0].assignmentId).toBe(84);
    expect(normalized[0].totalPoints).toBe(7);
    expect(normalized[0].choices).toBeNull();
    expect(normalized[0].scoring).toEqual(
      expect.objectContaining({
        type: "CRITERIA_BASED",
      }),
    );
  });
});
