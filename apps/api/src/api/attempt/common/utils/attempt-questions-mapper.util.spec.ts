import { QuestionType } from "@prisma/client";
import {
  AssignmentAttemptWithRelations,
  AssignmentForMapping,
  AttemptQuestionsMapper,
  EnhancedAttemptQuestionDto,
} from "./attempt-questions-mapper.util";

describe("AttemptQuestionsMapper", () => {
  it("preserves question response metadata when mapping learner attempts", async () => {
    const metadata = {
      aiFeedback: "AI feedback",
      deterministicFeedback: [{ feedback: "Deterministic feedback" }],
    };

    const assignmentAttempt = {
      id: 1,
      questionOrder: [101],
      questionResponses: [
        {
          id: 10,
          assignmentAttemptId: 1,
          questionId: 101,
          learnerResponse: "Answer",
          points: 1,
          feedback: [{ feedback: "Deterministic feedback" }],
          metadata,
        },
      ],
      questionVariants: [],
    } as unknown as AssignmentAttemptWithRelations;

    const questions = [
      {
        id: 101,
        question: "Question?",
        type: QuestionType.TEXT,
        totalPoints: 1,
        assignmentId: 99,
        choices: [],
        gradingContextQuestionIds: [],
        isDeleted: false,
      },
    ] as unknown as EnhancedAttemptQuestionDto[];

    const assignment = {
      id: 99,
      questionOrder: [101],
    } as AssignmentForMapping;

    const result = await AttemptQuestionsMapper.buildQuestionsWithResponses(
      assignmentAttempt,
      questions,
      assignment,
      {} as never,
    );

    expect(result[0].questionResponses?.[0].metadata).toEqual(metadata);
  });
});
