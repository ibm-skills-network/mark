import { Choice } from "../dto/update.questions.request.dto";
import { resolveTrueFalseAnswer } from "./true-false-answer.util";

const choice = (partial: Partial<Choice>): Choice => partial as Choice;

describe("resolveTrueFalseAnswer", () => {
  // The production shape: [True, False], isCorrect marking the answer.
  const trueFalse = (correct: "true" | "false"): Choice[] => [
    choice({
      id: 0,
      choice: "True",
      isCorrect: correct === "true",
      points: correct === "true" ? 1 : 0,
    }),
    choice({
      id: 1,
      choice: "False",
      isCorrect: correct === "false",
      points: correct === "false" ? 1 : 0,
    }),
  ];

  it("resolves True-answer questions", () => {
    expect(resolveTrueFalseAnswer(trueFalse("true"))).toEqual({
      correctAnswer: true,
      correctPoints: 1,
    });
  });

  it("resolves False-answer questions", () => {
    // The regression: choices[0] is the True row, so any position-keyed
    // logic marks False-answer questions inverted — correct learners wrong,
    // wrong learners right.
    expect(resolveTrueFalseAnswer(trueFalse("false"))).toEqual({
      correctAnswer: false,
      correctPoints: 1,
    });
  });

  it("takes points from the correct choice, not the first one", () => {
    const choices = [
      choice({ id: 0, choice: "True", isCorrect: false, points: 0 }),
      choice({ id: 1, choice: "False", isCorrect: true, points: 2 }),
    ];
    expect(resolveTrueFalseAnswer(choices)?.correctPoints).toBe(2);
  });

  it("survives a flipped storage order", () => {
    const flipped = [
      choice({ id: 1, choice: "False", isCorrect: true, points: 1 }),
      choice({ id: 0, choice: "True", isCorrect: false, points: 0 }),
    ];
    expect(resolveTrueFalseAnswer(flipped)?.correctAnswer).toBe(false);
  });

  it("falls back to position when the correct choice's label is unusable", () => {
    const unlabeled = [
      choice({
        id: 0,
        choice: null as unknown as string,
        isCorrect: true,
        points: 1,
      }),
      choice({ id: 1, choice: "False", isCorrect: false, points: 0 }),
    ];
    // First position is the True choice by authoring convention.
    expect(resolveTrueFalseAnswer(unlabeled)?.correctAnswer).toBe(true);
  });

  it("falls back to the first label when no choice is flagged correct", () => {
    const legacy = [
      choice({ id: 0, choice: "false", isCorrect: false, points: 1 }),
    ];
    expect(resolveTrueFalseAnswer(legacy)).toEqual({
      correctAnswer: false,
      correctPoints: 1,
    });
  });

  it("returns null when there is nothing to resolve against", () => {
    expect(resolveTrueFalseAnswer([])).toBeNull();
    expect(resolveTrueFalseAnswer(undefined)).toBeNull();
    expect(resolveTrueFalseAnswer(null)).toBeNull();
  });
});
