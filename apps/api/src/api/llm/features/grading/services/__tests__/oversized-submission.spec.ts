/* eslint-disable */
/**
 * Tests for the per-submission block-count cap and the typed
 * OversizedSubmissionError. Covers:
 *
 *  - Tabular text exceeding the cap throws OversizedSubmissionError with
 *    structured fields and emits a structured warn log.
 *  - Tabular text below the cap returns blocks unchanged (no throw, no warn).
 *  - Non-tabular paragraph text is unaffected.
 */

import { LearnerFacingGradingError } from "../../errors/learner-facing-grading.error";
import { OversizedSubmissionError } from "../../errors/oversized-submission.error";

function buildService() {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const service = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../file-grading.service").FileGradingService.prototype,
  );

  service.logger = mockLogger;
  service.evidenceBasedGrading = { gradeSubmission: jest.fn() };
  service.pdfAnnotationService = {};
  service.s3Service = {};
  service.moderationService = {
    assessContent: jest.fn().mockResolvedValue({
      action: "allow",
      flaggedCategories: [],
      severeCategories: [],
    }),
  };
  service.llmResolver = {
    getModelForGradingTask: jest.fn(),
    getModelKeyWithFallback: jest.fn(),
  };
  service.promptProcessor = { processPromptForFeature: jest.fn() };
  service.tokenCounter = { countTokens: jest.fn().mockReturnValue(100) };

  return { service, mockLogger };
}

describe("OversizedSubmissionError class", () => {
  it("is an instance of Error and carries structured fields", () => {
    const err = new OversizedSubmissionError({
      blockCount: 60000,
      cap: 50000,
      filename: "huge.xlsx",
      questionId: 42,
      attemptId: 7,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OversizedSubmissionError);
    expect(err.name).toBe("OversizedSubmissionError");
    expect(err.blockCount).toBe(60000);
    expect(err.cap).toBe(50000);
    expect(err.filename).toBe("huge.xlsx");
    expect(err.questionId).toBe(42);
    expect(err.attemptId).toBe(7);
    expect(err.message).toMatch(/60000/);
  });

  it("is an instance of the LearnerFacingGradingError base class", () => {
    const err = new OversizedSubmissionError({ blockCount: 1, cap: 1 });
    expect(err).toBeInstanceOf(LearnerFacingGradingError);
    expect(err).toBeInstanceOf(OversizedSubmissionError);
    expect(err.name).toBe("OversizedSubmissionError");
  });

  it("preserves instanceof across re-throw boundaries", () => {
    const err = new OversizedSubmissionError({ blockCount: 1, cap: 1 });
    try {
      throw err;
    } catch (caught) {
      expect(caught).toBeInstanceOf(OversizedSubmissionError);
      expect(caught).toBeInstanceOf(Error);
    }
  });

  it("exposes a learner-facing message naming the file when known", () => {
    const err = new OversizedSubmissionError({
      blockCount: 60_000,
      cap: 50_000,
      filename: "thesis.pdf",
    });

    expect(err.learnerMessage).toBe(
      '"thesis.pdf" is too large for automatic grading. Try reducing its length (fewer pages, rows, or sheets) and submit it again.',
    );
    // No internal jargon leaks to learners.
    expect(err.learnerMessage).not.toMatch(/block|cap/i);
  });

  it("exposes a generic learner-facing message when the filename is unknown", () => {
    const err = new OversizedSubmissionError({ blockCount: 2, cap: 1 });

    expect(err.learnerMessage).toBe(
      "Your submission is too large for automatic grading. Try reducing its length (fewer pages, rows, or sheets) and submit it again.",
    );
  });
});

describe("FileGradingService.splitTextIntoEvidenceBlocks cap enforcement", () => {
  it("throws OversizedSubmissionError when tabular text exceeds the cap", () => {
    const { service, mockLogger } = buildService();
    // Build a tabular payload with 60_000 newline-separated rows. The
    // " | " token makes the splitter take the tabular branch.
    const rowCount = 60000;
    const rows: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      rows.push(`val${i} | data${i}`);
    }
    const text = rows.join("\n");

    let thrown: unknown;
    try {
      service.splitTextIntoEvidenceBlocks(text, 1, {
        filename: "monster.xlsx",
        questionId: 1234,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(OversizedSubmissionError);
    const oe = thrown as OversizedSubmissionError;
    expect(oe.blockCount).toBe(rowCount);
    expect(oe.cap).toBe(50000);
    expect(oe.filename).toBe("monster.xlsx");
    expect(oe.questionId).toBe(1234);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "grading.submission.oversized",
      expect.objectContaining({
        blockCount: rowCount,
        cap: 50000,
        filename: "monster.xlsx",
        questionId: 1234,
      }),
    );
  });

  it("returns blocks unchanged when tabular text is under the cap", () => {
    const { service, mockLogger } = buildService();
    const rows: string[] = [];
    for (let i = 0; i < 100; i++) {
      rows.push(`val${i} | data${i}`);
    }
    const text = rows.join("\n");

    const result = service.splitTextIntoEvidenceBlocks(text, 1, {
      filename: "small.xlsx",
      questionId: 99,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(100);
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      "grading.submission.oversized",
      expect.anything(),
    );
  });

  it("does not throw when raw line count exceeds the cap but the filtered count is under it", () => {
    const { service, mockLogger } = buildService();
    // A sparse spreadsheet: many blank/whitespace-only lines inflate the raw
    // line count past the cap, but only a small number of real data rows
    // survive the trim/non-empty filter. The cap must apply to the filtered set.
    const dataRowCount = 200;
    const blankRowCount = 60000;
    const rows: string[] = [];
    for (let i = 0; i < dataRowCount; i++) {
      rows.push(`val${i} | data${i}`);
    }
    for (let i = 0; i < blankRowCount; i++) {
      rows.push("   ");
    }
    const text = rows.join("\n");
    expect(text.split("\n").length).toBeGreaterThan(50000);

    const result = service.splitTextIntoEvidenceBlocks(text, 1, {
      filename: "sparse.xlsx",
      questionId: 7,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(dataRowCount);
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      "grading.submission.oversized",
      expect.anything(),
    );
  });

  it("reports the filtered (not raw) block count when the cap is exceeded", () => {
    const { service } = buildService();
    // Filtered count exceeds the cap; interleaved blank lines must NOT be
    // counted, so the reported blockCount equals the real data-row count.
    const dataRowCount = 60000;
    const rows: string[] = [];
    for (let i = 0; i < dataRowCount; i++) {
      rows.push(`val${i} | data${i}`);
      rows.push("");
    }
    const text = rows.join("\n");

    let thrown: unknown;
    try {
      service.splitTextIntoEvidenceBlocks(text, 1, {
        filename: "dense.xlsx",
        questionId: 11,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(OversizedSubmissionError);
    const oe = thrown as OversizedSubmissionError;
    expect(oe.blockCount).toBe(dataRowCount);
    expect(oe.cap).toBe(50000);
  });

  it("non-tabular paragraph text under the cap is unchanged", () => {
    const { service, mockLogger } = buildService();
    const text =
      "This is paragraph one.\n\nThis is paragraph two.\n\nAnd a third paragraph.";

    const result = service.splitTextIntoEvidenceBlocks(text, 1);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(10);
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      "grading.submission.oversized",
      expect.anything(),
    );
  });
});
