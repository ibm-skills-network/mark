import { FileGradingStrategy } from "./file-grading.strategy";
import { FileContentExtractionService } from "../../services/file-content-extraction";
import { SourceProcessingError } from "../../../llm/features/grading/errors/source-processing.error";
import { assertRequiredSourceEvidence } from "../utils/required-source-evidence";

describe("required file evidence containment", () => {
  const context = {
    assignmentInstructions: "",
    questionAnswerContext: [],
    assignmentId: 10,
    attemptId: 20,
  };
  const question = { id: 30, question: "Upload your work", totalPoints: 10 };
  const good = {
    filename: "work.txt",
    fileType: "text/plain",
    content: "learner work",
  };

  function strategyFor(extraction: unknown) {
    const strategy = Object.create(FileGradingStrategy.prototype);
    strategy.fileContentExtractionService = extraction;
    strategy.llmFacadeService = { gradeFileBasedQuestion: jest.fn() };
    strategy.iterativeGradingWithJudge = jest.fn();
    strategy.recordGrading = jest.fn();
    strategy.logger = { warn: jest.fn() };
    return strategy;
  }

  it.each([
    { ...good, error: "parser failed" },
    { ...good, content: "[ERROR extracting work.txt: parser failed]" },
    { ...good, content: "[PDF FILE - EXTRACTION FAILED]" },
    { ...good, content: "[PDF - BASIC TEXT EXTRACTION] raw bytes" },
    { ...good, metadata: { size: 5, extractionFailed: true } },
    { ...good, content: "" },
  ])("blocks a failed required file in a mixed upload: %j", async (bad) => {
    const strategy = strategyFor({
      extractContentFromFiles: jest.fn().mockResolvedValue([good, bad]),
    });
    await expect(
      strategy.gradeResponse(question, [good, bad], context),
    ).rejects.toBeInstanceOf(SourceProcessingError);
    expect(
      strategy.llmFacadeService.gradeFileBasedQuestion,
    ).not.toHaveBeenCalled();
    expect(strategy.iterativeGradingWithJudge).not.toHaveBeenCalled();
    expect(strategy.recordGrading).not.toHaveBeenCalled();
    expect(strategy.logger.warn).toHaveBeenCalledWith(
      "grading.source_processing.blocked",
      expect.objectContaining({
        attemptId: 20,
        questionId: 30,
        sourceReference: "file:1",
        scoringBlocked: true,
      }),
    );
  });

  it("accepts valid vision evidence and leaves blank-answer policy to the caller", () => {
    expect(() =>
      assertRequiredSourceEvidence(
        [
          {
            ...good,
            content: "",
            useVisionMode: true,
            fileUrl: "https://example.com/image",
          },
        ],
        1,
      ),
    ).not.toThrow();
    expect(() => assertRequiredSourceEvidence([], 0)).not.toThrow();
    expect(() =>
      assertRequiredSourceEvidence(
        [{ ...good, content: "", metadata: { size: 0 } }],
        1,
      ),
    ).not.toThrow();
    expect(() => assertRequiredSourceEvidence([good], 2)).toThrow(
      SourceProcessingError,
    );
  });

  it.each(["broken.pdf", "broken.zip", "broken.xlsx", "broken.ipynb"])(
    "blocks real malformed %s extraction before grading",
    async (filename) => {
      const extractor = new FileContentExtractionService(
        {} as never,
        {} as never,
      );
      const strategy = strategyFor(extractor);
      const file = {
        filename,
        fileType: "application/octet-stream",
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff]),
      };
      await expect(
        strategy.gradeResponse(question, [file], context),
      ).rejects.toBeInstanceOf(SourceProcessingError);
      expect(
        strategy.llmFacadeService.gradeFileBasedQuestion,
      ).not.toHaveBeenCalled();
    },
  );
});

it("keeps COS outages retryable instead of treating them as corrupt learner files", async () => {
  const extractor = new FileContentExtractionService(
    {
      getObject: jest.fn().mockRejectedValue(new Error("storage unavailable")),
    } as never,
    {} as never,
  );
  const [result] = await extractor.extractContentFromFiles([
    {
      filename: "work.txt",
      fileType: "text/plain",
      bucket: "b",
      key: "k",
    } as never,
  ]);
  expect(() => assertRequiredSourceEvidence([result], 1)).toThrow(
    expect.objectContaining({
      name: "RetryableProcessingError",
      retryable: true,
      reason: "source_unavailable",
    }),
  );
});
