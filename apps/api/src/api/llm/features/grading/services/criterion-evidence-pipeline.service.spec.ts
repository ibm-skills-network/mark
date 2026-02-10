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

    const pipeline = new CriterionEvidencePipelineService(
      evidenceRetrieval as any,
      gradingService as any,
      judgeService as any,
      new CriterionRetryManagerService(),
      new CriterionGradeCompilerService(),
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
});
