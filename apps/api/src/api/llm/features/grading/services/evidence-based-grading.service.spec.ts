/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CanonicalSubmission,
  ContentBlock,
} from "src/api/attempt/services/structured-content.models";
import { RubricCriterion } from "../types/criterion-evidence.types";
import { EvidenceBasedGradingService } from "./evidence-based-grading.service";
import { EvidenceChunkingService } from "./evidence-chunking.service";
import { SubmissionQualityService } from "./submission-quality.service";

const QUESTION =
  "Explain the concept of data normalization and its importance in database design.";

const ANSWER_TEXT =
  "Normalization organizes relational tables into smaller structures to reduce redundancy and improve integrity.";

function makeLogger(): any {
  const logger: any = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return logger;
}

function block(
  blockId: string,
  text: string,
  type: ContentBlock["type"] = "paragraph",
  page = 1,
  extra: Partial<ContentBlock> = {},
): ContentBlock {
  return { blockId, type, text, page, ...extra };
}

function makeSubmission(blocks: ContentBlock[]): CanonicalSubmission {
  const pageNumbers = [...new Set(blocks.map((b) => b.page))].sort(
    (a, b) => a - b,
  );
  return {
    submissionId: "sub-1",
    metadata: {
      wordCount: 100,
      pageCount: Math.max(pageNumbers.length, 1),
      blockCount: blocks.length,
      sourceType: "pdf",
      checksum: "checksum-1",
      extractedAt: new Date().toISOString(),
    },
    pages:
      pageNumbers.length > 0
        ? pageNumbers.map((pageNumber) => ({
            pageNumber,
            blocks: blocks.filter((b) => b.page === pageNumber),
          }))
        : [{ pageNumber: 1, blocks: [] }],
  };
}

const TWO_LEVEL_CRITERION: RubricCriterion = {
  id: "c1",
  rubricQuestion: "Normalization coverage",
  description: "",
  criteria: [
    { description: "Not addressed", points: 0 },
    { description: "Fully addressed", points: 5 },
  ],
  maxPoints: 5,
};

const NONZERO_MIN_CRITERION: RubricCriterion = {
  id: "c2",
  rubricQuestion: "Writing quality",
  description: "",
  criteria: [
    { description: "Poor", points: 2 },
    { description: "Good", points: 4 },
  ],
  maxPoints: 4,
};

const COMPLETION_ONLY_CRITERION: RubricCriterion = {
  id: "c3",
  rubricQuestion: "Submission completed",
  description: "",
  criteria: [{ description: "Completed", points: 3 }],
  maxPoints: 3,
};

function makeService(overrides: {
  pipeline?: any;
  promptProcessor?: any;
  imageDescriptions?: Map<string, string>;
}) {
  const promptProcessor = overrides.promptProcessor ?? {
    processPromptForFeature: jest.fn(() => {
      throw new Error("promptProcessor must not be called");
    }),
  };
  const imageDescriptionService = {
    describeImagesForGrading: jest
      .fn()
      .mockResolvedValue(overrides.imageDescriptions ?? new Map()),
  };
  const highlightingGenerator = {
    generateHighlightsFromEvidence: jest
      .fn()
      .mockReturnValue({ pages: {}, blockHighlights: {} }),
  };
  const pipeline = overrides.pipeline ?? {
    gradeWithEvidence: jest.fn(() => {
      throw new Error("pipeline must not be called");
    }),
  };

  const service = new EvidenceBasedGradingService(
    promptProcessor as any,
    imageDescriptionService as any,
    highlightingGenerator as any,
    new EvidenceChunkingService(),
    pipeline as any,
    new SubmissionQualityService(),
    makeLogger(),
  );

  return {
    service,
    promptProcessor,
    pipeline,
    imageDescriptionService,
    highlightingGenerator,
  };
}

/** Pipeline mock that succeeds, citing the first chunk it receives per criterion. */
function successfulPipeline() {
  return {
    gradeWithEvidence: jest.fn(async (request: any) => {
      const grades = request.criteria.map((criterion: RubricCriterion) => ({
        criterionId: criterion.id,
        rubricQuestion: criterion.rubricQuestion,
        pointsAwarded: criterion.maxPoints,
        maxPoints: criterion.maxPoints,
        rationale: "Pipeline graded with cited evidence.",
        citations: [request.chunks[0].chunkId],
        confidence: "high",
        decision: "meets",
        evidence: [],
        attempt: 1,
        gradedAt: new Date().toISOString(),
        modelUsed: "test-model",
      }));
      return {
        grades,
        evidence: [],
        judgeCritiques: [],
        summary: {
          totalPoints: grades.reduce(
            (sum: number, g: any) => sum + g.pointsAwarded,
            0,
          ),
          maxPoints: grades.reduce(
            (sum: number, g: any) => sum + g.maxPoints,
            0,
          ),
          criteria: grades,
          allCitations: [],
          allRationales: [],
          compiledAt: new Date().toISOString(),
        },
        audit: { marker: "pipeline-audit" },
      };
    }),
  };
}

describe("EvidenceBasedGradingService (orchestration)", () => {
  describe("clean multi-criterion submission", () => {
    it("maps pipeline grades and preserves pipeline audit metadata", async () => {
      const pipeline = successfulPipeline();
      const { service } = makeService({ pipeline });

      const submission = makeSubmission([
        block("p1b1", ANSWER_TEXT),
        block(
          "p1b2",
          "Second Normal Form eliminates partial dependencies on the key.",
        ),
      ]);

      const result = await service.gradeSubmission(
        submission,
        [TWO_LEVEL_CRITERION, NONZERO_MIN_CRITERION],
        QUESTION,
        1,
      );

      expect(result.totalPoints).toBe(9);
      expect(result.maxPossiblePoints).toBe(9);
      expect(result.criteriaResults).toHaveLength(2);
      expect(result.criteriaResults[0].evidence[0].blockId).toBe("p1b1");
      expect((result.metadata as any).auditLog).toEqual({
        marker: "pipeline-audit",
      });
    });
  });

  describe("structured/table submissions", () => {
    it("passes table chunks to the pipeline and disables judge retries", async () => {
      const pipeline = successfulPipeline();
      const { service } = makeService({ pipeline });

      const submission = makeSubmission([
        block("p1b1", "Region | Sales\nEast | 100\nWest | 200", "table", 1, {
          table: { rows: [["East", "100"]], headers: ["Region", "Sales"] },
        }),
      ]);

      await service.gradeSubmission(
        submission,
        [TWO_LEVEL_CRITERION],
        QUESTION,
        1,
      );

      const request = pipeline.gradeWithEvidence.mock.calls[0][0];
      expect(request.maxRetries).toBe(0);
      expect(
        request.chunks.some((c: any) => c.metadata?.blockType === "table"),
      ).toBe(true);
    });
  });

  describe("image submissions", () => {
    it("describes images and forwards image chunks to the pipeline", async () => {
      const pipeline = successfulPipeline();
      const descriptions = new Map([
        ["p1b2", "A bar chart showing revenue by quarter."],
      ]);
      const { service, imageDescriptionService } = makeService({
        pipeline,
        imageDescriptions: descriptions,
      });

      const submission = makeSubmission([
        block("p1b1", ANSWER_TEXT),
        block("p1b2", "", "image", 1, { imageData: "base64-image-data" }),
      ]);

      await service.gradeSubmission(
        submission,
        [TWO_LEVEL_CRITERION],
        QUESTION,
        1,
      );

      expect(
        imageDescriptionService.describeImagesForGrading,
      ).toHaveBeenCalledTimes(1);
      const request = pipeline.gradeWithEvidence.mock.calls[0][0];
      expect(request.chunks.some((c: any) => c.anchor.type === "image")).toBe(
        true,
      );
    });
  });

  describe("pipeline failure with eligible evidence (safe fallback)", () => {
    it("filters excluded content out of fallback grading and citation validation", async () => {
      const pipeline = {
        gradeWithEvidence: jest
          .fn()
          .mockRejectedValue(new Error("pipeline exploded")),
      };
      const promptProcessor = {
        processPromptForFeature: jest.fn().mockResolvedValue(
          JSON.stringify({
            evidence: [
              { blockId: "p1b1", quote: ANSWER_TEXT.slice(0, 60), page: 1 },
              { blockId: "p1b2", quote: QUESTION, page: 1 },
            ],
            decision: "meets",
            pointsAwarded: 5,
            rationale:
              "Block p1b1 contains a full explanation of normalization concepts.",
          }),
        ),
      };
      const { service } = makeService({ pipeline, promptProcessor });

      const submission = makeSubmission([
        block("p1b1", ANSWER_TEXT),
        block("p1b2", QUESTION), // prompt copy — excluded by the quality gate
      ]);

      const result = await service.gradeSubmission(
        submission,
        [TWO_LEVEL_CRITERION],
        QUESTION,
        1,
      );

      // Excluded block must be invisible to the fallback grader's context...
      const promptArg =
        promptProcessor.processPromptForFeature.mock.calls[0][0];
      const renderedPrompt = await promptArg.format({});
      expect(renderedPrompt).toContain("p1b1");
      expect(renderedPrompt).not.toContain("p1b2");

      // ...and its citation must be dropped from the result.
      const citedBlocks = result.criteriaResults[0].evidence.map(
        (e) => e.blockId,
      );
      expect(citedBlocks).toContain("p1b1");
      expect(citedBlocks).not.toContain("p1b2");
      expect(result.criteriaResults[0].pointsAwarded).toBe(5);

      // Fallback audit metadata records the quality decision and reason.
      const audit = (result.metadata as any).auditLog;
      expect(result.metadata.modelUsed).toBe("legacy_fallback_qualified");
      expect(audit.fallbackReason).toBe("pipeline exploded");
      expect(audit.submissionQuality.eligibleChunkCount).toBe(1);
      expect(
        audit.submissionQuality.ineligibleReasonBreakdown.prompt_copy,
      ).toBe(1);
    });
  });

  describe("pipeline failure with no eligible evidence (quality gate)", () => {
    it("awards rubric minimums without calling the LLM and records gated audit metadata", async () => {
      const pipeline = {
        gradeWithEvidence: jest
          .fn()
          .mockRejectedValue(new Error("pipeline exploded")),
      };
      const { service, promptProcessor } = makeService({ pipeline });

      const submission = makeSubmission([
        block("p1b1", QUESTION), // prompt copy only
      ]);

      const result = await service.gradeSubmission(
        submission,
        [TWO_LEVEL_CRITERION, NONZERO_MIN_CRITERION, COMPLETION_ONLY_CRITERION],
        QUESTION,
        1,
      );

      expect(promptProcessor.processPromptForFeature).not.toHaveBeenCalled();
      expect(result.criteriaResults.map((c) => c.pointsAwarded)).toEqual([
        0, // min of 0/5
        2, // non-zero rubric minimum preserved
        3, // completion-only criterion: min === max, policy awards it
      ]);
      expect(result.criteriaResults.every((c) => c.evidence.length === 0)).toBe(
        true,
      );

      const audit = (result.metadata as any).auditLog;
      expect(result.metadata.modelUsed).toBe("quality_gate_fallback");
      expect(audit.fallbackReason).toBe("pipeline exploded");
      expect(audit.submissionQuality.gated).toBe(true);
      expect(audit.submissionQuality.eligibleChunkCount).toBe(0);
      expect(
        audit.finalSelection.every(
          (s: any) => s.reason === "quality_gate_no_eligible_chunks",
        ),
      ).toBe(true);
    });

    it("handles a completely empty submission the same way", async () => {
      const pipeline = {
        gradeWithEvidence: jest
          .fn()
          .mockRejectedValue(new Error("pipeline exploded")),
      };
      const { service, promptProcessor } = makeService({ pipeline });

      const submission = makeSubmission([]);

      const result = await service.gradeSubmission(
        submission,
        [TWO_LEVEL_CRITERION],
        QUESTION,
        1,
      );

      expect(promptProcessor.processPromptForFeature).not.toHaveBeenCalled();
      expect(result.totalPoints).toBe(0);
      const audit = (result.metadata as any).auditLog;
      expect(audit.submissionQuality.classification).toBe("empty");
      expect(audit.submissionQuality.gated).toBe(true);
    });
  });
});
