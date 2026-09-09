import { CriterionJudgeService } from "./criterion-judge.service";
import {
  CriterionEvidenceResponse,
  CriterionGrade,
} from "../types/criterion-evidence.types";

async function renderEvidence(evidence: CriterionEvidenceResponse[]) {
  let rendered = "";
  const service = new CriterionJudgeService(
    {
      processStructuredPrompt: async (prompt: {
        format: (input: object) => Promise<string>;
      }) => {
        rendered = await prompt.format({});
        return { approved: true, issues: [], summary: "Valid" };
      },
    } as any,
    { getModelKeyWithFallback: async () => "gpt-4o-mini" } as any,
  );
  await service.judge({
    question: "Demonstrate programming fluency",
    criteria: [],
    grades: evidence.map((item) => ({
      criterionId: item.criterionId,
      pointsAwarded: 2,
      maxPoints: 2,
      citations: item.evidence.map((entry) => entry.chunkId),
      rationale: "The source is complete.",
    })) as CriterionGrade[],
    evidence,
    assignmentId: 1,
  });
  return rendered;
}

function criterion(
  criterionId: string,
  quotes: string[],
): CriterionEvidenceResponse {
  return {
    criterionId,
    evidence: quotes.map((quote, index) => ({
      chunkId: `chunk-${index}`,
      quote,
      anchor: { type: "file", page: 1, blockId: `b${index}` },
      sourceType: "file",
      sourceId: "source.js",
      relevanceScore: 1,
    })),
    strategyUsed: "search",
    retrievedAt: new Date().toISOString(),
  };
}

describe("CriterionJudgeService evidence", () => {
  it("preserves source beyond 300 characters and citations beyond the first three", async () => {
    const code =
      "// introduction\n".repeat(30) + "function complete() { return 42; }";
    const prompt = await renderEvidence([
      criterion("c1", [code, "second", "third", "fourth evidence"]),
    ]);
    expect(prompt).toContain(code);
    expect(prompt).toContain("fourth evidence");
  });

  it("renders shared evidence once while preserving each criterion's membership", async () => {
    const quote = "UNIQUE_SOURCE_BODY";
    const prompt = await renderEvidence([
      criterion("c1", [quote]),
      criterion("c2", [quote]),
    ]);
    expect(prompt.split(quote)).toHaveLength(2);
    expect(prompt).toContain("c1: chunk-0");
    expect(prompt).toContain("c2: chunk-0");
  });

  it("keeps distinct excerpts of the same chunk rather than silently discarding one", async () => {
    const prompt = await renderEvidence([
      criterion("c1", ["first excerpt"]),
      criterion("c2", ["different excerpt"]),
    ]);
    expect(prompt).toContain("first excerpt");
    expect(prompt).toContain("different excerpt");
  });
});
