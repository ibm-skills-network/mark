/* eslint-disable */
/**
 * Tests for the per-submission evidence-block cap on the PDF extraction path.
 * The cap previously only covered spreadsheet text splitting; PDFs arrived
 * with structuredContent already built and bypassed the ceiling entirely.
 *
 * Covers:
 *  - Assembled block count above the cap throws OversizedSubmissionError with
 *    its name intact (the jobs worker name-matches on it) and structured
 *    fields, plus a structured warn log.
 *  - Block count at/under the cap does not throw.
 */

import { OversizedSubmissionError } from "../../../llm/features/grading/errors/oversized-submission.error";
import { MAX_EVIDENCE_BLOCKS_PER_SUBMISSION } from "../../../llm/features/grading/constants";

function buildExtractor() {
  const mockLogger = {
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const extractor = Object.create(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../pdf-structure-extractor.service").PdfStructureExtractorService
      .prototype,
  );
  extractor.logger = mockLogger;

  return { extractor, mockLogger };
}

describe("PdfStructureExtractorService block-cap enforcement", () => {
  it("throws OversizedSubmissionError when the assembled block count exceeds the cap", () => {
    const { extractor, mockLogger } = buildExtractor();
    const blockCount = MAX_EVIDENCE_BLOCKS_PER_SUBMISSION + 1;

    let thrown: unknown;
    try {
      extractor.enforceBlockCap(blockCount, "huge_report.pdf");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(OversizedSubmissionError);
    const oe = thrown as OversizedSubmissionError;
    // Name must survive for the worker's terminal-error classification.
    expect(oe.name).toBe("OversizedSubmissionError");
    expect(oe.blockCount).toBe(blockCount);
    expect(oe.cap).toBe(MAX_EVIDENCE_BLOCKS_PER_SUBMISSION);
    expect(oe.filename).toBe("huge_report.pdf");

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const warnArg = mockLogger.warn.mock.calls[0][0] as string;
    expect(warnArg).toContain("grading.submission.oversized");
    expect(warnArg).toContain(`"blockCount":${blockCount}`);
    expect(warnArg).toContain(`"cap":${MAX_EVIDENCE_BLOCKS_PER_SUBMISSION}`);
    expect(warnArg).toContain(`"branch":"pdf"`);
  });

  it("does not throw when the block count is at the cap", () => {
    const { extractor, mockLogger } = buildExtractor();

    expect(() =>
      extractor.enforceBlockCap(MAX_EVIDENCE_BLOCKS_PER_SUBMISSION, "ok.pdf"),
    ).not.toThrow();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("does not throw when the block count is under the cap", () => {
    const { extractor, mockLogger } = buildExtractor();

    expect(() => extractor.enforceBlockCap(10, "small.pdf")).not.toThrow();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
