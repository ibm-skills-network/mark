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
  it.each([false, true])(
    "returns the selected attempt and its evidence after retries (notebook images: %s)",
    async (notebookImages) => {
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
        anchor: notebookImages
          ? { type: "image", page: 1, imageId: "image" }
          : { type: "text", startOffset: 0, endOffset: 10 },
        metadata: notebookImages ? { filename: "submission.ipynb" } : undefined,
        hash: "hash1",
      };

      const evidenceRetrieval = {
        retrieveEvidence: jest
          .fn()
          .mockImplementation(async ({ judgeFeedback }) => ({
            criterionId: "c1",
            evidence: [
              {
                chunkId: "chunk1",
                quote: judgeFeedback ? "retry evidence" : "evidence",
                anchor: { type: "text", startOffset: 0, endOffset: 10 },
                sourceType: "text",
                sourceId: "answer",
                relevanceScore: 0.9,
              },
            ],
            strategyUsed: "search",
            retrievedAt: new Date().toISOString(),
            debug: { candidateCount: 1, validatedCount: 1 },
          })),
      };

      const gradingService = {
        gradeCriterion: jest
          .fn()
          .mockImplementation(
            ({ attempt, evidence }: { attempt: number; evidence: any[] }) => {
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
                    quote: evidence[0].quote,
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
            },
          ),
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
      expect(result.evidence[0].evidence[0].quote).toBe("evidence");
      expect(evidenceRetrieval.retrieveEvidence).toHaveBeenCalledTimes(
        notebookImages ? 3 : 1,
      );
      expect(result.audit.finalSelection[0].reason).toBe(
        "highest_support_score",
      );
    },
  );
});

it("rechecks missed notebook evidence before grading an audit retry", async () => {
  const criterion: RubricCriterion = {
    id: "count",
    rubricQuestion: "Count images",
    description: "",
    maxPoints: 2,
    criteria: [
      { description: "Correct count", points: 2 },
      { description: "Missing", points: 0 },
    ],
  };
  const chunk: ExtractedChunk = {
    chunkId: "image",
    hash: "image",
    text: "A photograph",
    sourceType: "file",
    sourceId: "submission",
    anchor: { type: "image", page: 1, imageId: "image" },
    metadata: { filename: "submission.ipynb" },
  };
  const evidence = {
    chunkId: "count",
    quote: "print(len(paths))\n3000",
    anchor: { type: "file", page: 1, blockId: "count" },
    sourceType: "file",
    sourceId: "submission",
    relevanceScore: 1,
    notebookRenderedOutput: true,
  };
  const retrieval = {
    retrieveEvidence: jest
      .fn()
      .mockResolvedValueOnce({ criterionId: "count", evidence: [] })
      .mockResolvedValue({ criterionId: "count", evidence: [evidence] }),
  };
  const grader = {
    gradeCriterion: jest.fn().mockImplementation(async (request) => ({
      criterionId: "count",
      rubricQuestion: "Count images",
      pointsAwarded: request.evidence.length ? 2 : 0,
      maxPoints: 2,
      rationale: "Assessment",
      citations: request.evidence.map((item) => item.chunkId),
      confidence: "high",
      decision: request.evidence.length ? "meets" : "does_not_meet",
      evidence: request.evidence,
      attempt: request.attempt,
      gradedAt: new Date().toISOString(),
      modelUsed: "test",
    })),
  };
  const issue = {
    criterionId: "count",
    severity: "high",
    issue: "The count output was overlooked.",
  };
  const judge = {
    judge: jest
      .fn()
      .mockResolvedValueOnce({ approved: false, issues: [issue] })
      .mockResolvedValue({ approved: true, issues: [] }),
  };
  const pipeline = new CriterionEvidencePipelineService(
    retrieval as any,
    grader as any,
    judge as any,
    new CriterionRetryManagerService(),
    new CriterionGradeCompilerService(),
  );
  const result = await pipeline.gradeWithEvidence({
    question: "Question",
    criteria: [criterion],
    chunks: [chunk],
    assignmentId: 1,
    maxRetries: 1,
  });
  expect(retrieval.retrieveEvidence).toHaveBeenCalledTimes(2);
  expect(retrieval.retrieveEvidence.mock.calls[1][0].judgeFeedback).toContain(
    issue.issue,
  );
  expect(grader.gradeCriterion.mock.calls[1][0].evidence).toEqual([evidence]);
  expect(judge.judge.mock.calls[1][0].evidence[0].evidence).toEqual([evidence]);
  expect(result.grades[0].pointsAwarded).toBe(2);
});
