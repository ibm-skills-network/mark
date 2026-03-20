import { QuestionAuthorStore } from "@/config/types";
import { applyQuestionOrder } from "../question-order";

const makeQuestion = (id: number, index: number): QuestionAuthorStore => ({
  id,
  index,
  question: `Question ${id}`,
  type: "TEXT",
  totalPoints: 1,
  scoring: {
    type: "CRITERIA_BASED",
    rubrics: [],
  },
  numRetries: 1,
  choices: [],
  variants: [],
  alreadyInBackend: true,
  answer: null,
  assignmentId: 1,
  gradingContextQuestionIds: [],
  randomizedChoices: false,
});

describe("applyQuestionOrder", () => {
  it("respects backend order and normalizes indices", () => {
    const questions = [
      makeQuestion(1, 1),
      makeQuestion(2, 2),
      makeQuestion(3, 3),
    ];

    const result = applyQuestionOrder(questions, [3, 1, 2]);

    expect(result.questionOrder).toEqual([3, 1, 2]);
    expect(result.questions.map((q) => q.id)).toEqual([3, 1, 2]);
    expect(result.questions.map((q) => q.index)).toEqual([1, 2, 3]);
  });

  it("drops duplicates and invalid ids while appending missing questions", () => {
    const questions = [
      makeQuestion(10, 1),
      makeQuestion(11, 2),
      makeQuestion(12, 3),
    ];

    const result = applyQuestionOrder(questions, [99, 10, 10]);

    expect(result.questionOrder).toEqual([10, 11, 12]);
    expect(result.questions.map((q) => q.id)).toEqual([10, 11, 12]);
  });

  it("falls back to existing order when desired order is empty", () => {
    const questions = [makeQuestion(5, 1), makeQuestion(6, 2)];

    const result = applyQuestionOrder(questions, []);

    expect(result.questionOrder).toEqual([5, 6]);
    expect(result.questions.map((q) => q.id)).toEqual([5, 6]);
  });

  it("appends newly added questions that are missing from backend order", () => {
    const questions = [
      makeQuestion(1, 1),
      makeQuestion(2, 2),
      makeQuestion(99, 3),
    ];

    const result = applyQuestionOrder(questions, [2, 1]);

    expect(result.questionOrder).toEqual([2, 1, 99]);
    expect(result.questions.map((q) => q.id)).toEqual([2, 1, 99]);
    expect(result.questions.map((q) => q.index)).toEqual([1, 2, 3]);
  });
});
