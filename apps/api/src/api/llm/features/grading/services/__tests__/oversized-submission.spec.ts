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
    validateContent: jest.fn().mockResolvedValue(true),
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

  it("preserves instanceof across re-throw boundaries", () => {
    const err = new OversizedSubmissionError({ blockCount: 1, cap: 1 });
    try {
      throw err;
    } catch (caught) {
      expect(caught).toBeInstanceOf(OversizedSubmissionError);
      expect(caught).toBeInstanceOf(Error);
    }
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
