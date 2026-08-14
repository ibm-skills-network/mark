import { PromptTemplate } from "@langchain/core/prompts";
import { IPromptProcessor } from "src/api/llm/core/interfaces/prompt-processor.interface";
import { LLMResolverService } from "src/api/llm/core/services/llm-resolver.service";
import {
  CriterionEvidence,
  RubricCriterion,
} from "../types/criterion-evidence.types";
import {
  CRITERION_GRADING_CACHE_KEY,
  CriterionGradingService,
} from "./criterion-grading.service";

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

  it("uses deterministic native structured output", async () => {
    const promptProcessor = {
      processStructuredPrompt: jest.fn().mockResolvedValue({
        score: 2,
        rationale: "The cited evidence satisfies this criterion.",
        citations: ["ch1"],
        confidence: "high",
      }),
    } as unknown as IPromptProcessor;

    const llmResolver = {
      getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
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
    expect(result.rationale).toContain("satisfies");
    expect(result.citations).toEqual(["ch1"]);
    expect(result.confidence).toBe("high");
    expect(promptProcessor.processStructuredPrompt).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.anything(),
      expect.anything(),
      "gpt-4o-mini",
      expect.objectContaining({
        temperature: 0,
        maxRetries: 1,
        modelName: "gpt-4o-mini-2024-07-18",
        promptCache: expect.objectContaining({
          key: CRITERION_GRADING_CACHE_KEY,
        }),
      }),
    );
  });

  it("declares a cache prefix that the formatted prompt actually starts with", async () => {
    const promptProcessor = {
      processStructuredPrompt: jest.fn().mockResolvedValue({
        score: 2,
        rationale: "The cited evidence satisfies this criterion.",
        citations: ["ch1"],
        confidence: "high",
      }),
    } as unknown as IPromptProcessor;

    const llmResolver = {
      getModelKeyWithFallback: jest.fn().mockResolvedValue("gpt-4o-mini"),
    } as unknown as LLMResolverService;

    const service = new CriterionGradingService(promptProcessor, llmResolver);
    await service.gradeCriterion({
      criterion: baseCriterion,
      evidence: baseEvidence,
      question: "Question",
      assignmentId: 1,
      attempt: 1,
    });

    const call = (promptProcessor.processStructuredPrompt as jest.Mock).mock
      .calls[0];
    const prompt = call[0] as PromptTemplate;
    const options = call[5] as { promptCache?: { prefix: string } };
    const formatted = await prompt.format({});

    // The whole mechanism turns on this one equality. If the head and the
    // template ever render differently — an unescaped brace, a stray newline —
    // the request still succeeds and simply stops caching, so nothing else in
    // the system would notice.
    expect(options.promptCache?.prefix).toBeDefined();
    expect(formatted.startsWith(options.promptCache?.prefix ?? "")).toBe(true);
    expect(formatted.length).toBeGreaterThan(
      (options.promptCache?.prefix ?? "").length,
    );
  });
});
