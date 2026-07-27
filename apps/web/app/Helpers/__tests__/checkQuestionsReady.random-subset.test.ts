import { renderHook } from "@testing-library/react";
import type { Question } from "../../../config/types";
import { useQuestionsAreReadyToBePublished } from "../checkQuestionsReady";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAuthorStore } from "@/stores/author";

// A Random Subset larger than the question pool is only reachable on
// assignments authored before the input was capped, so the review screen has
// to report it as a configuration issue instead of publishing it quietly.
describe("useQuestionsAreReadyToBePublished - Random Subset count", () => {
  const makeQuestion = (id: number, overrides: Partial<Question> = {}) =>
    ({
      id,
      question: `Question ${id}`,
      type: "TEXT",
      totalPoints: 5,
      assignmentId: 1,
      ...overrides,
    }) as Question;

  beforeEach(() => {
    useAuthorStore.setState({ introduction: "<p>Intro</p>" });
    useAssignmentConfig.setState({ numberOfQuestionsPerAttempt: null });
  });

  const validate = (questions: Question[]) =>
    renderHook(() =>
      useQuestionsAreReadyToBePublished(questions),
    ).result.current();

  it("flags a subset count larger than the pool", () => {
    useAssignmentConfig.setState({ numberOfQuestionsPerAttempt: 5 });

    const result = validate([makeQuestion(1), makeQuestion(2)]);

    expect(result.isValid).toBe(false);
    expect(result.message).toContain("Random Subset");
    // Null so the review screen files it under Configuration Error rather than
    // hunting for a question to attach it to.
    expect(result.invalidQuestionId).toBeNull();
  });

  it("counts only questions that are not deleted", () => {
    useAssignmentConfig.setState({ numberOfQuestionsPerAttempt: 2 });

    const result = validate([
      makeQuestion(1),
      makeQuestion(2, { isDeleted: true }),
    ]);

    expect(result.isValid).toBe(false);
  });

  it("accepts a subset count the pool can satisfy", () => {
    useAssignmentConfig.setState({ numberOfQuestionsPerAttempt: 1 });

    expect(validate([makeQuestion(1), makeQuestion(2)]).isValid).toBe(true);
  });

  it("accepts an unset subset count", () => {
    expect(validate([makeQuestion(1)]).isValid).toBe(true);
  });
});
