import { validationMessageNeedsOwnPanel } from "../validationMessage";

describe("validationMessageNeedsOwnPanel", () => {
  it("stays quiet when validation passed", () => {
    expect(validationMessageNeedsOwnPanel(true, "", null, {})).toBe(false);
  });

  it("stays quiet when there is no message to show", () => {
    expect(validationMessageNeedsOwnPanel(false, "", null, {})).toBe(false);
  });

  it("claims a config error even when the message mentions questions", () => {
    // The substring heuristic this replaced treated both of these as
    // question-specific and swallowed them.
    expect(
      validationMessageNeedsOwnPanel(
        false,
        "Question order is required.",
        null,
        {},
      ),
    ).toBe(true);
    expect(
      validationMessageNeedsOwnPanel(
        false,
        "Random Subset is set to 5 but only 2 question(s) exist.",
        null,
        {},
      ),
    ).toBe(true);
  });

  it("defers to the per-question list when it already covers that question", () => {
    expect(
      validationMessageNeedsOwnPanel(false, "Question 1 has no choices.", 7, {
        7: ["No choices added"],
      }),
    ).toBe(false);
  });

  it("takes its own panel when the per-question list does not cover that question", () => {
    // questionIssues runs a narrower set of checks — nothing in it inspects
    // variants — so without this the message renders nowhere at all.
    expect(
      validationMessageNeedsOwnPanel(
        false,
        "Question 3 variant 2 must have exactly 1 choices.",
        7,
        { 9: ["No rubrics defined"] },
      ),
    ).toBe(true);
  });

  it("takes its own panel when the named question has an empty issue list", () => {
    expect(
      validationMessageNeedsOwnPanel(false, "Question 1 text is empty.", 7, {
        7: [],
      }),
    ).toBe(true);
  });
});
