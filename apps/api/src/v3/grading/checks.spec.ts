import {
  applyEvidenceChecks,
  normalizeWhitespace,
  structuralFailures,
} from "./checks";
import type { ModelGradeOutput, Part, RubricCriterion } from "./contracts";

const criteria: RubricCriterion[] = [
  { id: "c1", description: "States the result", maxPoints: 2 },
  { id: "c2", description: "Explains the method", maxPoints: 3 },
];

const parts: Part[] = [
  {
    name: "answer",
    kind: "text",
    text: "The result is 42.\n\nI used   binary\nsearch over the sorted list.",
  },
  {
    name: "report.pdf",
    kind: "file",
    mimeType: "application/pdf",
    base64: "AA==",
  },
];

function output(verdicts: ModelGradeOutput["verdicts"]): ModelGradeOutput {
  return { verdicts, overallFeedback: "ok" };
}

function verdict(
  criterionId: string,
  points: number,
  quotes: Array<{ part: string; text: string }> = [],
): ModelGradeOutput["verdicts"][number] {
  return { criterionId, points, reason: "r", quotes, feedback: "f" };
}

describe("structuralFailures", () => {
  it("passes one in-bounds verdict per criterion", () => {
    expect(
      structuralFailures(
        output([verdict("c1", 2), verdict("c2", 0)]),
        criteria,
      ),
    ).toEqual([]);
  });

  it("flags a missing criterion", () => {
    const failures = structuralFailures(output([verdict("c1", 1)]), criteria);
    expect(failures).toEqual([
      expect.objectContaining({ code: "missing_verdict", criterionId: "c2" }),
    ]);
  });

  it("flags an unknown criterion id", () => {
    const failures = structuralFailures(
      output([verdict("c1", 1), verdict("c2", 1), verdict("c9", 1)]),
      criteria,
    );
    expect(failures.map((failure) => failure.code)).toEqual([
      "unknown_criterion",
    ]);
  });

  it("flags a duplicate verdict", () => {
    const failures = structuralFailures(
      output([verdict("c1", 1), verdict("c1", 2), verdict("c2", 1)]),
      criteria,
    );
    expect(failures.map((failure) => failure.code)).toEqual([
      "duplicate_verdict",
    ]);
  });

  it.each([
    [-1, "below zero"],
    [2.5, "above the maximum"],
    [Number.NaN, "not a number"],
  ])("flags points %p (%s)", (points) => {
    const failures = structuralFailures(
      output([verdict("c1", points), verdict("c2", 0)]),
      criteria,
    );
    expect(failures).toEqual([
      expect.objectContaining({
        code: "points_out_of_bounds",
        criterionId: "c1",
      }),
    ]);
  });
});

describe("applyEvidenceChecks", () => {
  it("keeps points backed by an exact quote", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [{ part: "answer", text: "The result is 42." }]),
        verdict("c2", 0),
      ]),
      criteria,
      parts,
    );
    expect(result.failures).toEqual([]);
    expect(result.verdicts.map((item) => item.points)).toEqual([2, 0]);
  });

  it("accepts a quote that differs only in whitespace", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 0),
        verdict("c2", 3, [
          {
            part: "answer",
            text: "I used binary search  over\tthe sorted list.",
          },
        ]),
      ]),
      criteria,
      parts,
    );
    expect(result.failures).toEqual([]);
    expect(result.verdicts[1].points).toBe(3);
  });

  it("zeroes points whose only quote is fabricated", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [{ part: "answer", text: "The result is 41." }]),
        verdict("c2", 0),
      ]),
      criteria,
      parts,
    );
    expect(result.verdicts[0]).toEqual(
      expect.objectContaining({ criterionId: "c1", points: 0, quotes: [] }),
    );
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "quote_not_found",
      "points_without_evidence",
    ]);
  });

  it("zeroes points awarded with no quote at all", () => {
    const result = applyEvidenceChecks(
      output([verdict("c1", 1), verdict("c2", 0)]),
      criteria,
      parts,
    );
    expect(result.verdicts[0].points).toBe(0);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "points_without_evidence",
        criterionId: "c1",
      }),
    ]);
  });

  it("keeps points when one quote is real and another is not", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [
          { part: "answer", text: "invented" },
          { part: "answer", text: "result is 42" },
        ]),
        verdict("c2", 0),
      ]),
      criteria,
      parts,
    );
    expect(result.verdicts[0].points).toBe(2);
    expect(result.verdicts[0].quotes).toEqual([
      { part: "answer", text: "result is 42" },
    ]);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "quote_not_found",
    ]);
  });

  it("accepts any non-empty quote from a file part, rejects an empty one", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [{ part: "report.pdf", text: "Figure 3 shows 42" }]),
        verdict("c2", 1, [{ part: "report.pdf", text: "   " }]),
      ]),
      criteria,
      parts,
    );
    expect(result.verdicts.map((item) => item.points)).toEqual([2, 0]);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "quote_empty",
      "points_without_evidence",
    ]);
  });

  it("rejects a quote from a part that does not exist", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [{ part: "other.txt", text: "The result is 42." }]),
        verdict("c2", 0),
      ]),
      criteria,
      parts,
    );
    expect(result.verdicts[0].points).toBe(0);
    expect(result.failures[0].code).toBe("quote_unknown_part");
  });

  it("never puts quote text in failure details", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [{ part: "answer", text: "secret learner words" }]),
        verdict("c2", 0),
      ]),
      criteria,
      parts,
    );
    for (const failure of result.failures) {
      expect(failure.detail).not.toContain("secret learner words");
    }
  });
});

describe("normalizeWhitespace", () => {
  it("collapses runs and trims", () => {
    expect(normalizeWhitespace("  a \n\t b  ")).toBe("a b");
  });
});
