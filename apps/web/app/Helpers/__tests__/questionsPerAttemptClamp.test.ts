import { describeQuestionsPerAttemptClamp } from "../questionsPerAttemptClamp";

describe("describeQuestionsPerAttemptClamp", () => {
  it("says nothing when the pool can satisfy the count", () => {
    expect(describeQuestionsPerAttemptClamp(2, 5)).toBeNull();
    expect(describeQuestionsPerAttemptClamp(5, 5)).toBeNull();
  });

  it("says nothing when no subset is configured", () => {
    expect(describeQuestionsPerAttemptClamp(null, 0)).toBeNull();
    expect(describeQuestionsPerAttemptClamp(undefined, 0)).toBeNull();
    expect(describeQuestionsPerAttemptClamp(0, 0)).toBeNull();
  });

  it("warns that publishing will lower an oversized count", () => {
    const notice = describeQuestionsPerAttemptClamp(5, 2);

    expect(notice).toContain("only 2 questions");
    expect(notice).toContain("lower this to 2");
  });

  it("keeps the singular reading for a one-question pool", () => {
    expect(describeQuestionsPerAttemptClamp(5, 1)).toContain(
      "only 1 question,",
    );
  });

  it("warns that an empty pool clears the setting", () => {
    // Matches the API clamp, which folds an empty pool to null rather than 0.
    expect(describeQuestionsPerAttemptClamp(5, 0)).toContain(
      "publishing will clear the Random Subset setting",
    );
  });
});
