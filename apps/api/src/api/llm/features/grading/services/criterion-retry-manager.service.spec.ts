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
});
