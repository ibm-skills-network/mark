import { Logger } from "winston";
import { CanonicalSubmission } from "src/api/attempt/services/structured-content.models";
import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { LearnerFacingGradingError } from "../errors/learner-facing-grading.error";
import { RubricCriterion } from "../types/criterion-evidence.types";
import { CriterionEvidencePipelineService } from "./criterion-evidence-pipeline.service";
import { EvidenceBasedGradingService } from "./evidence-based-grading.service";
import { EvidenceChunkingService } from "./evidence-chunking.service";
import { HighlightingGeneratorService } from "./highlighting-generator.service";
import { ImageDescriptionService } from "./image-description.service";

/**
 * These cover the legacy per-criterion fallback, which runs whenever the
 * evidence pipeline throws. It used to answer a failed criterion with zero
 * points and a `does_not_meet` decision, so an unreadable file or a provider
 * outage was recorded as work the learner had failed to do.
 */
describe("EvidenceBasedGradingService — criterion failures never become scores", () => {
  const criterion: RubricCriterion = {
    id: "criterion_0",
    rubricQuestion: "Explain the concept",
    description: "",
    criteria: [
      { description: "Not met", points: 0 },
      { description: "Met", points: 4 },
    ],
    maxPoints: 4,
  };

  const submission: CanonicalSubmission = {
    submissionId: "sub-1",
    metadata: {
      wordCount: 10,
      pageCount: 1,
      blockCount: 1,
      sourceType: "txt",
      checksum: "abc123",
      extractedAt: "2026-08-07T00:00:00.000Z",
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: "b1",
            page: 1,
            type: "paragraph",
            text: "The learner wrote a real answer here.",
          },
        ],
      },
    ],
  } as unknown as CanonicalSubmission;

  function buildService(promptProcessor: IPromptProcessor): {
    service: EvidenceBasedGradingService;
  } {
    const logger = {
      child: () => logger,
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    // The pipeline always throws here, which is what routes grading onto the
    // legacy per-criterion path these tests are about.
    const evidencePipeline = {
      gradeWithEvidence: jest
        .fn()
        .mockRejectedValue(new Error("pipeline unavailable")),
    } as unknown as CriterionEvidencePipelineService;

    const service = new EvidenceBasedGradingService(
      promptProcessor,
      {
        describeImages: jest.fn().mockResolvedValue(undefined),
      } as unknown as ImageDescriptionService,
      {
        generateHighlightsFromEvidence: jest
          .fn()
          .mockReturnValue({ pages: {}, blockHighlights: {} }),
      } as unknown as HighlightingGeneratorService,
      {
        extractFromSubmission: jest.fn().mockReturnValue([]),
      } as unknown as EvidenceChunkingService,
      evidencePipeline,
      logger,
    );

    return { service };
  }

  const grade = (service: EvidenceBasedGradingService) =>
    service.gradeSubmission(submission, [criterion], "Question?", 1, "en");

  it("fails the job instead of scoring zero when a criterion cannot be graded", async () => {
    const promptProcessor = {
      processPromptForFeature: jest
        .fn()
        .mockRejectedValue(
          new Error("400 Invalid body: failed to parse JSON value."),
        ),
    } as unknown as IPromptProcessor;

    const { service } = buildService(promptProcessor);

    // The regression: this used to resolve with pointsAwarded 0 rather than reject.
    await expect(grade(service)).rejects.toThrow(
      "400 Invalid body: failed to parse JSON value.",
    );
  });

  it("retries a transient failure and keeps the recovered grade", async () => {
    const processPromptForFeature = jest
      .fn()
      .mockRejectedValueOnce(new Error("503 upstream unavailable"))
      .mockResolvedValue(
        JSON.stringify({
          evidence: [
            {
              blockId: "b1",
              quote: "The learner wrote a real answer here.",
              page: 1,
            },
          ],
          decision: "meets",
          pointsAwarded: 4,
          rationale: "The submission addresses the criterion in full.",
          explanation:
            "The cited sentence directly answers what the criterion asks for.",
        }),
      );

    const { service } = buildService({
      processPromptForFeature,
    } as unknown as IPromptProcessor);

    const result = await grade(service);

    expect(processPromptForFeature).toHaveBeenCalledTimes(2);
    expect(result.totalPoints).toBe(4);
    expect(result.criteriaResults[0].pointsAwarded).toBe(4);
  });

  it("stops retrying a learner-facing error rather than burning attempts", async () => {
    class UnreadableFileError extends LearnerFacingGradingError {
      constructor() {
        super("no gradable text");
        Object.setPrototypeOf(this, UnreadableFileError.prototype);
      }
      get learnerMessage(): string {
        return "We couldn't read your file.";
      }
    }

    const processPromptForFeature = jest
      .fn()
      .mockRejectedValue(new UnreadableFileError());

    const { service } = buildService({
      processPromptForFeature,
    } as unknown as IPromptProcessor);

    await expect(grade(service)).rejects.toBeInstanceOf(UnreadableFileError);
    expect(processPromptForFeature).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of attempts", async () => {
    const processPromptForFeature = jest
      .fn()
      .mockRejectedValue(new Error("429 rate limited"));

    const { service } = buildService({
      processPromptForFeature,
    } as unknown as IPromptProcessor);

    await expect(grade(service)).rejects.toThrow("429 rate limited");
    expect(processPromptForFeature).toHaveBeenCalledTimes(3);
  });
});
