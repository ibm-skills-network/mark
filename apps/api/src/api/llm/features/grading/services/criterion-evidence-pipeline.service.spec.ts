/* eslint-disable */
import {
  CriterionGrade,
  ExtractedChunk,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import { CriterionEvidencePipelineService } from "./criterion-evidence-pipeline.service";
import { CriterionGradeCompilerService } from "./criterion-grade-compiler.service";
import { CriterionRetryManagerService } from "./criterion-retry-manager.service";

describe("CriterionEvidencePipelineService", () => {
  it("selects best supported attempt after retries", async () => {
    const criterion: RubricCriterion = {
      id: "c1",
      rubricQuestion: "Criterion",
      description: "",
      criteria: [
        { description: "Not met", points: 0 },
        { description: "Met", points: 4 },
      ],
      maxPoints: 4,
    };

    const chunk: ExtractedChunk = {
      chunkId: "chunk1",
      text: "evidence text",
      sourceType: "text",
      sourceId: "answer",
      anchor: { type: "text", startOffset: 0, endOffset: 10 },
      hash: "hash1",
    };

    const evidenceRetrieval = {
      retrieveEvidence: jest.fn().mockResolvedValue({
        criterionId: "c1",
        evidence: [
          {
            chunkId: "chunk1",
            quote: "evidence",
            anchor: { type: "text", startOffset: 0, endOffset: 10 },
            sourceType: "text",
            sourceId: "answer",
            relevanceScore: 0.9,
          },
        ],
        strategyUsed: "search",
        retrievedAt: new Date().toISOString(),
        debug: { candidateCount: 1, validatedCount: 1 },
      }),
    };

    const gradingService = {
      gradeCriterion: jest
        .fn()
        .mockImplementation(({ attempt }: { attempt: number }) => {
          const relevance = attempt === 1 ? 0.9 : attempt === 2 ? 0.1 : 0.2;
          const points = attempt === 1 ? 2 : 4;

          const grade: CriterionGrade = {
            criterionId: "c1",
            rubricQuestion: "Criterion",
            pointsAwarded: points,
            maxPoints: 4,
            rationale: `attempt ${attempt}`,
            citations: ["chunk1"],
            confidence: "medium",
            decision: attempt === 1 ? "partially_meets" : "meets",
            evidence: [
              {
                chunkId: "chunk1",
                quote: "evidence",
                anchor: { type: "text", startOffset: 0, endOffset: 10 },
                sourceType: "text",
                sourceId: "answer",
                relevanceScore: relevance,
              },
            ],
            attempt,
            gradedAt: new Date().toISOString(),
            modelUsed: "test",
          };

          return Promise.resolve(grade);
        }),
    };

    const judgeService = {
      judge: jest.fn().mockResolvedValue({
        approved: false,
        issues: [
          {
            criterionId: "c1",
            severity: "high",
            issue: "Citation mismatch",
          },
        ],
        summary: "Needs retry",
      }),
    };

    const qualityService = {
      classifyChunks: jest
        .fn()
        .mockImplementation((chunks: ExtractedChunk[]) => ({
          chunks,
          quality: {
            classification: "clean",
            gated: false,
            qualityWarnings: [],
            rawChunkCount: chunks.length,
            eligibleChunkCount: chunks.length,
            ineligibleChunkCount: 0,
            boilerplateRatio: 0,
            ineligibleReasonBreakdown: {},
          },
        })),
    };

    const pipeline = new CriterionEvidencePipelineService(
      evidenceRetrieval as any,
      gradingService as any,
      judgeService as any,
      new CriterionRetryManagerService(),
      new CriterionGradeCompilerService(),
      qualityService as any,
    );

    const result = await pipeline.gradeWithEvidence({
      question: "Question",
      criteria: [criterion],
      chunks: [chunk],
      assignmentId: 1,
      maxRetries: 2,
    });

    expect(result.grades[0].attempt).toBe(1);
    expect(result.audit.finalSelection[0].reason).toBe("highest_support_score");
  });

  it("short-circuits to minimum rubric points when the quality gate rejects all chunks", async () => {
    const { SubmissionQualityService } = await import(
      "./submission-quality.service"
    );

    const twoLevelCriterion: RubricCriterion = {
      id: "c-two",
      rubricQuestion: "Two-level criterion",
      description: "",
      criteria: [
        { description: "Not met", points: 2 },
        { description: "Met", points: 5 },
      ],
      maxPoints: 5,
    };

    // Completion-only rubric: single level, min === max — policy awards it.
    const oneLevelCriterion: RubricCriterion = {
      id: "c-one",
      rubricQuestion: "Completion-only criterion",
      description: "",
      criteria: [{ description: "Completed", points: 3 }],
      maxPoints: 3,
    };

    const ineligibleChunks: ExtractedChunk[] = [
      {
        chunkId: "meta",
        text: "=== PDF DOCUMENT ===",
        sourceType: "file",
        sourceId: "sub",
        anchor: { type: "file", page: 1, blockId: "b1" },
        hash: "meta",
      },
      {
        chunkId: "label",
        text: "Page 1 of 3",
        sourceType: "file",
        sourceId: "sub",
        anchor: { type: "file", page: 1, blockId: "b2" },
        hash: "label",
      },
    ];

    const mustNotBeCalled = jest.fn(() => {
      throw new Error("must not be called when quality gate fires");
    });

    const pipeline = new CriterionEvidencePipelineService(
      { retrieveEvidence: mustNotBeCalled } as any,
      { gradeCriterion: mustNotBeCalled } as any,
      { judge: mustNotBeCalled } as any,
      new CriterionRetryManagerService(),
      new CriterionGradeCompilerService(),
      new SubmissionQualityService(),
    );

    const result = await pipeline.gradeWithEvidence({
      question: "Question text for the assignment",
      criteria: [twoLevelCriterion, oneLevelCriterion],
      chunks: ineligibleChunks,
      assignmentId: 1,
    });

    expect(mustNotBeCalled).not.toHaveBeenCalled();
    expect(result.grades).toHaveLength(2);
    expect(result.grades[0].pointsAwarded).toBe(2); // non-zero rubric minimum
    // Non-empty submission: completion-only criterion still awards its level.
    expect(result.grades[1].pointsAwarded).toBe(3);
    expect(result.summary.totalPoints).toBe(5);
    expect(result.audit.submissionQuality?.gated).toBe(true);
    expect(result.audit.submissionQuality?.eligibleChunkCount).toBe(0);
    expect(
      result.audit.finalSelection.every(
        (selection) => selection.reason === "quality_gate_no_eligible_chunks",
      ),
    ).toBe(true);
  });

  it("assigns zero to completion-only criteria for completely empty submissions", async () => {
    const { SubmissionQualityService } = await import(
      "./submission-quality.service"
    );

    const twoLevelCriterion: RubricCriterion = {
      id: "c-two",
      rubricQuestion: "Two-level criterion",
      description: "",
      criteria: [
        { description: "Not met", points: 2 },
        { description: "Met", points: 5 },
      ],
      maxPoints: 5,
    };

    const oneLevelCriterion: RubricCriterion = {
      id: "c-one",
      rubricQuestion: "Completion-only criterion",
      description: "",
      criteria: [{ description: "Completed", points: 3 }],
      maxPoints: 3,
    };

    const mustNotBeCalled = jest.fn(() => {
      throw new Error("must not be called when quality gate fires");
    });

    const pipeline = new CriterionEvidencePipelineService(
      { retrieveEvidence: mustNotBeCalled } as any,
      { gradeCriterion: mustNotBeCalled } as any,
      { judge: mustNotBeCalled } as any,
      new CriterionRetryManagerService(),
      new CriterionGradeCompilerService(),
      new SubmissionQualityService(),
    );

    const result = await pipeline.gradeWithEvidence({
      question: "Question text for the assignment",
      criteria: [twoLevelCriterion, oneLevelCriterion],
      chunks: [], // completely empty submission
      assignmentId: 1,
    });

    expect(mustNotBeCalled).not.toHaveBeenCalled();
    expect(result.grades[0].pointsAwarded).toBe(2); // multi-level minimum kept
    expect(result.grades[1].pointsAwarded).toBe(0); // completion-only: empty ⇒ 0
    expect(result.audit.submissionQuality?.classification).toBe("empty");
    expect(result.audit.submissionQuality?.gated).toBe(true);
  });
});
