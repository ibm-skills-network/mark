import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { LLMResolverService } from "src/api/llm/core/services/llm-resolver.service";
import {
  CriterionEvidence,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import { CriterionGradingService } from "./criterion-grading.service";

describe("CriterionGradingService", () => {
  const baseCriterion: RubricCriterion = {
    id: "c1",
    rubricQuestion: "Explain concept",
    description: "",
    criteria: [
      { description: "Not met", points: 0 },
      { description: "Met", points: 2 },
    ],
    maxPoints: 2,
  };

  const baseEvidence: CriterionEvidence[] = [
    {
      chunkId: "ch1",
      quote: "Evidence text",
      anchor: { type: "file", page: 1, blockId: "b1" },
      sourceType: "file",
      sourceId: "submission",
      relevanceScore: 0.8,
    },
  ];

  it("returns minimum points when evidence is empty", async () => {
    const service = new CriterionGradingService(
      {} as IPromptProcessor,
      {} as LLMResolverService,
    );

    const result = await service.gradeCriterion({
      criterion: baseCriterion,
      evidence: [],
      question: "Question",
      assignmentId: 1,
      attempt: 1,
    });

    expect(result.pointsAwarded).toBe(0);
    expect(result.decision).toBe("does_not_meet");
    expect(result.citations).toHaveLength(0);
  });

  it("parses lenient JSON outputs that fail strict schema checks", async () => {
    const promptProcessor = {
      processPromptForFeature: jest
        .fn()
        .mockResolvedValue(
          '{"score":"2","rationale":"Too short.","citations":"ch1","confidence":"High"}',
        ),
    } as unknown as IPromptProcessor;

    const llmResolver = {
      getModelForGradingTask: jest.fn().mockResolvedValue("test-model"),
    } as unknown as LLMResolverService;

    const service = new CriterionGradingService(promptProcessor, llmResolver);

    const result = await service.gradeCriterion({
      criterion: baseCriterion,
      evidence: baseEvidence,
      question: "Question",
      assignmentId: 1,
      attempt: 1,
    });

    expect(result.pointsAwarded).toBe(2);
    expect(result.rationale).toContain("Too short");
    expect(result.citations).toEqual(["ch1"]);
    expect(result.confidence).toBe("high");
  });
});
