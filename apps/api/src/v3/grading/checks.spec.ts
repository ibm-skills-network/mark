import {
  applyEvidenceChecks,
  checkQuote,
  normalizeForQuote,
  normalizeWhitespace,
  structuralFailures,
} from "./checks";
import { htmlToMarkdown } from "./html-text";
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

  it("checks quotes from a rendered file part against its text parts", () => {
    const rendered: Part[] = [
      { name: "deck.pptx", kind: "text", text: "## Slide 1\nRevenue grew 12%" },
      {
        name: "deck.pptx (slides)",
        kind: "file",
        mimeType: "application/pdf",
        base64: "AA==",
        verifyAgainst: ["deck.pptx"],
      },
    ];
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [
          { part: "deck.pptx (slides)", text: "Revenue grew 12%" },
        ]),
        verdict("c2", 3, [
          { part: "deck.pptx (slides)", text: "Costs fell by half" },
        ]),
      ]),
      criteria,
      rendered,
    );
    expect(result.verdicts.map((item) => item.points)).toEqual([2, 0]);
    expect(result.quoteChecks.map((check) => check.accepted)).toEqual([
      true,
      false,
    ]);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "quote_not_found",
      "points_without_evidence",
    ]);
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

describe("normalizeForQuote", () => {
  it("unifies quotes and dashes, strips Markdown marks, unescapes and lowercases", () => {
    expect(
      normalizeForQuote(
        '\u201CIt\u2019s\u201D \u2014 **Bold**  `code`\\n\\"x\\"\\tEnd',
      ),
    ).toBe(`"it's" - bold code "x" end`);
  });
});

describe("checkQuote", () => {
  const essay: Part = {
    name: "essay.docx",
    kind: "text",
    text: "Model choice.\nI chose **gradient boosting** because it handles missing values well and trains quickly on tabular data with many categorical features.",
  };
  const link: Part = {
    name: "https://github.com/jane/churn-model",
    kind: "text",
    text: "README\nA churn model.",
  };

  it("accepts a verbatim quote", () => {
    expect(
      checkQuote({ part: "essay.docx", text: "Model choice." }, essay),
    ).toEqual({
      accepted: true,
      rule: "verbatim",
    });
  });

  it("accepts a quote that differs in case, quotes, Markdown marks and escapes", () => {
    expect(
      checkQuote(
        {
          part: "essay.docx",
          text: "model choice.\\nI chose gradient boosting",
        },
        essay,
      ),
    ).toEqual({ accepted: true, rule: "normalized" });
  });

  it("accepts a quote of the part's name, such as the submitted URL or repo", () => {
    expect(
      checkQuote(
        { part: link.name, text: "https://github.com/jane/churn-model" },
        link,
      ),
    ).toEqual({ accepted: true, rule: "part_name" });
    expect(
      checkQuote({ part: link.name, text: "jane/churn-model" }, link),
    ).toEqual({
      accepted: true,
      rule: "part_name",
    });
  });

  it("accepts a lightly paraphrased quote: 90% of its words, in order, in a short window", () => {
    // 20 words; one ("very") is not in the part.
    expect(
      checkQuote(
        {
          part: "essay.docx",
          text: "I chose gradient boosting because it handles missing values very well and trains quickly on tabular data with many categorical features",
        },
        essay,
      ),
    ).toEqual({ accepted: true, rule: "fuzzy" });
  });

  it("rejects fabricated quotes", () => {
    for (const text of [
      "I chose a random forest because it handles missing values well",
      "gradient boosting trains slowly",
      "The model reached 95% accuracy on the test set.",
      // Every word is in the part, but spread far apart.
      "choice handles features",
    ]) {
      expect(checkQuote({ part: "essay.docx", text }, essay)).toEqual({
        accepted: false,
        code: "quote_not_found",
      });
    }
  });

  it("stays fast on a long part full of the quote's words", () => {
    const words = ["the", "model", "and", "data", "of", "a", "to", "is"];
    const long: Part = {
      name: "long.txt",
      kind: "text",
      text: Array.from(
        { length: 200_000 },
        (_, index) => words[(index * 7) % 5],
      ).join(" "),
    };
    const quote = Array.from(
      { length: 300 },
      (_, index) => words[index % 8],
    ).join(" ");
    const started = Date.now();
    expect(checkQuote({ part: "long.txt", text: quote }, long).accepted).toBe(
      false,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rejects words of the part's name that are not the name", () => {
    expect(
      checkQuote({ part: link.name, text: "jane wrote tests" }, link),
    ).toEqual({
      accepted: false,
      code: "quote_not_found",
    });
  });

  it("reports which rule accepted each quote", () => {
    const result = applyEvidenceChecks(
      output([
        verdict("c1", 2, [
          { part: "answer", text: "The result is 42." },
          { part: "answer", text: "made up" },
        ]),
        verdict("c2", 1, [{ part: "report.pdf", text: "Figure 3" }]),
      ]),
      criteria,
      parts,
    );
    expect(result.quoteChecks).toEqual([
      { criterionId: "c1", part: "answer", accepted: true, rule: "verbatim" },
      {
        criterionId: "c1",
        part: "answer",
        accepted: false,
        code: "quote_not_found",
      },
      {
        criterionId: "c2",
        part: "report.pdf",
        accepted: true,
        rule: "file_part",
      },
    ]);
  });
});

describe("quotes from rich-text answers", () => {
  it("produces text the quote check accepts quotes from", () => {
    const text = htmlToMarkdown(
      "<p>I chose <strong>gradient boosting</strong> because it handles <code>NaN</code> values.</p>",
    );
    const { failures } = applyEvidenceChecks(
      {
        verdicts: [
          {
            criterionId: "c1",
            points: 1,
            reason: "r",
            quotes: [
              {
                part: "answer",
                text: "I chose gradient boosting because it handles NaN values",
              },
            ],
            feedback: "f",
          },
        ],
        overallFeedback: "",
      },
      [{ id: "c1", description: "d", maxPoints: 1 }],
      [{ name: "answer", kind: "text", text }],
    );
    expect(failures).toEqual([]);
  });
});
