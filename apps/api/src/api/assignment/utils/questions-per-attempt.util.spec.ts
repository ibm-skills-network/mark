import { clampQuestionsPerAttempt } from "./questions-per-attempt.util";

describe("clampQuestionsPerAttempt", () => {
  it("leaves a count the pool can satisfy untouched", () => {
    expect(clampQuestionsPerAttempt(2, 5)).toBe(2);
    expect(clampQuestionsPerAttempt(5, 5)).toBe(5);
  });

  it("folds an oversized count down to the pool", () => {
    expect(clampQuestionsPerAttempt(15, 3)).toBe(3);
  });

  it("collapses to null when there are no questions to draw from", () => {
    expect(clampQuestionsPerAttempt(15, 0)).toBeNull();
  });

  it("passes through the values that already mean 'serve everything'", () => {
    // Normalizing these would rewrite stored config without changing what a
    // learner sees.
    expect(clampQuestionsPerAttempt(null, 0)).toBeNull();
    expect(clampQuestionsPerAttempt(undefined, 3)).toBeUndefined();
    expect(clampQuestionsPerAttempt(0, 3)).toBe(0);
  });

  it("does not treat a negative count as oversized", () => {
    expect(clampQuestionsPerAttempt(-1, 3)).toBe(-1);
  });
});
