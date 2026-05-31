import { getSelectedChoiceIndexes } from "../choiceSelection";

describe("getSelectedChoiceIndexes", () => {
  it("marks only the chosen numeric answer, not the choice that shares its index", () => {
    // Reproduces the review-screen double-selection: answer texts are numbers,
    // the learner picked "3" (stored as text). The choice at index 3 happens to
    // be "2" — it must NOT also appear selected.
    const choices = [
      { choice: "3" },
      { choice: "1" },
      { choice: "4" },
      { choice: "2" },
    ];

    const selected = getSelectedChoiceIndexes(["3"], choices);

    expect([...selected].sort()).toEqual([0]);
  });

  it("does not bleed a numeric text answer into a positional index", () => {
    const choices = [{ choice: "1" }, { choice: "2" }, { choice: "0" }];

    const selected = getSelectedChoiceIndexes(["0"], choices);

    expect([...selected].sort()).toEqual([2]);
  });

  it("marks the correct choice by text for normal answers", () => {
    const choices = [{ choice: "Apple" }, { choice: "Banana" }];

    expect([...getSelectedChoiceIndexes(["Banana"], choices)]).toEqual([1]);
  });

  it("marks every selected answer for multiple-correct questions", () => {
    const choices = [{ choice: "A" }, { choice: "B" }, { choice: "C" }];

    expect([...getSelectedChoiceIndexes(["A", "C"], choices)].sort()).toEqual([
      0, 2,
    ]);
  });

  it("falls back to a positional index for legacy index-format answers", () => {
    // Older attempts stored the index, not the text. "0" matches no choice
    // text here, so it should resolve to the first choice.
    const choices = [
      { choice: "Apple" },
      { choice: "Banana" },
      { choice: "Cherry" },
    ];

    expect([...getSelectedChoiceIndexes(["0"], choices)]).toEqual([0]);
  });

  it("accepts a single string response", () => {
    const choices = [{ choice: "Yes" }, { choice: "No" }];

    expect([...getSelectedChoiceIndexes("No", choices)]).toEqual([1]);
  });

  it("returns an empty set when there is no answer", () => {
    const choices = [{ choice: "Apple" }, { choice: "Banana" }];

    expect(getSelectedChoiceIndexes(undefined, choices).size).toBe(0);
    expect(getSelectedChoiceIndexes([], choices).size).toBe(0);
  });

  it("ignores out-of-range or non-numeric legacy values", () => {
    const choices = [{ choice: "Apple" }];

    expect(getSelectedChoiceIndexes(["7"], choices).size).toBe(0);
    expect(getSelectedChoiceIndexes(["x"], choices).size).toBe(0);
  });
});
