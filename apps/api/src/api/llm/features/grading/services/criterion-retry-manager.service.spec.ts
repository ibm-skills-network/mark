import { CriterionRetryManagerService } from "./criterion-retry-manager.service";
import { CriterionGrade } from "../types/criterion-evidence.types";

describe("CriterionRetryManagerService", () => {
  it("penalizes contradiction evidence in support score", () => {
    const manager = new CriterionRetryManagerService();
    const baseGrade: CriterionGrade = {
      criterionId: "c1",
      rubricQuestion: "Criterion",
      pointsAwarded: 2,
      maxPoints: 4,
      rationale: "rationale",
      citations: ["chunk1"],
      confidence: "medium",
      decision: "partially_meets",
      evidence: [
        {
          chunkId: "chunk1",
          quote: "evidence",
          anchor: { type: "text", startOffset: 0, endOffset: 10 },
          sourceType: "text",
          sourceId: "s1",
          relevanceScore: 0.8,
        },
      ],
      attempt: 1,
      gradedAt: new Date().toISOString(),
      modelUsed: "test",
    };

    const withoutContradiction = manager.computeSupportScore(baseGrade, []);

    const withContradiction = manager.computeSupportScore(
      {
        ...baseGrade,
        evidence: [
          {
            ...baseGrade.evidence[0],
            contradiction: true,
          },
        ],
      },
      [],
    );

    expect(withContradiction.supportScore).toBeLessThan(
      withoutContradiction.supportScore,
    );
  });

  describe("selectBestAttempt", () => {
    const manager = new CriterionRetryManagerService();

    function attemptWith(attempt: number, supportScore: number) {
      return {
        attempt,
        grade: { criterionId: "c1", attempt } as CriterionGrade,
        support: {
          evidenceCount: 1,
          avgRelevance: 0.5,
          contradictionCount: 0,
          judgePenalty: 0.25,
          supportScore,
        },
        judgeIssues: [],
      };
    }

    it("prefers the latest attempt when support scores tie", () => {
      const selected = manager.selectBestAttempt([
        attemptWith(1, 0.35),
        attemptWith(2, 0.35),
        attemptWith(3, 0.35),
      ]);

      expect(selected.attempt).toBe(3);
    });

    it("treats scores within floating-point noise as a tie", () => {
      const selected = manager.selectBestAttempt([
        attemptWith(1, 0.1 + 0.2),
        attemptWith(2, 0.3),
      ]);

      expect(selected.attempt).toBe(2);
    });

    it("keeps an earlier attempt whose support is strictly higher", () => {
      const selected = manager.selectBestAttempt([
        attemptWith(1, 0.6),
        attemptWith(2, 0.35),
        attemptWith(3, 0.35),
      ]);

      expect(selected.attempt).toBe(1);
    });

    it("picks a later attempt whose support is strictly higher", () => {
      const selected = manager.selectBestAttempt([
        attemptWith(1, 0.35),
        attemptWith(2, 0.6),
        attemptWith(3, 0.35),
      ]);

      expect(selected.attempt).toBe(2);
    });
  });
});
