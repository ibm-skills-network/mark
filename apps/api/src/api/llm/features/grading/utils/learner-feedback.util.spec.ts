import {
  buildLearnerStructuredFeedback,
  sanitizeLearnerFeedback,
} from "./learner-feedback.util";

describe("learner feedback normalization", () => {
  it("removes internal grading references and canned LLM artifacts", () => {
    const result = sanitizeLearnerFeedback(
      "Based on the provided evidence, the explanation is incomplete. (e.g., p1b65) Additional corrections needed for full credit.",
    );

    expect(result).toBe("The explanation is incomplete.");
    expect(result).not.toMatch(/p1b65|full credit|provided evidence/i);
  });

  it("preserves ordinary uses of the word block", () => {
    expect(
      sanitizeLearnerFeedback(
        "Use a code block to show the revised implementation.",
      ),
    ).toBe("Use a code block to show the revised implementation.");
  });

  it("builds actionable structured feedback without leaking extraction IDs", () => {
    const feedback = buildLearnerStructuredFeedback(2, [
      {
        rubricQuestion: "How well was the data cleaned?",
        pointsAwarded: 2,
        maxPoints: 3,
        status: "partial",
        justification:
          "The notebook checks missing values, but does not explain how they were handled. (p1b16) Additional corrections needed for full credit.",
        evidence: [
          "p1:p1b16 The notebook calls df.info() and checks null counts.",
        ],
        nextStep:
          "Add a short cleaning summary naming affected columns, the chosen treatment, and how many values changed.",
      },
    ]);

    expect(feedback.summary).toBe(
      "You earned 2/3. 0 of 1 criteria were fully met.",
    );
    expect(feedback.criteria[0]).toMatchObject({
      name: "How well was the data cleaned?",
      feedback:
        "The notebook checks missing values, but does not explain how they were handled.",
      evidence: "The notebook calls df.info() and checks null counts.",
      nextStep:
        "Add a short cleaning summary naming affected columns, the chosen treatment, and how many values changed.",
    });
    expect(JSON.stringify(feedback)).not.toMatch(/p1b16|full credit/i);
  });

  it("limits the overall guidance to the three highest-priority incomplete criteria", () => {
    const feedback = buildLearnerStructuredFeedback(
      0,
      Array.from({ length: 4 }, (_, index) => ({
        rubricQuestion: `Criterion ${index + 1}`,
        pointsAwarded: 0,
        maxPoints: 1,
        status: "none" as const,
        justification: `The submission is missing item ${index + 1}.`,
        nextStep: `Add item ${index + 1} with a concrete example.`,
      })),
    );

    expect(feedback.guidance.split("\n")).toHaveLength(3);
    expect(feedback.guidance).not.toContain("Criterion 4");
  });
});
