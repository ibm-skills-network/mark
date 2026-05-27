/* eslint-disable */
import { CriterionJudgeService } from "./criterion-judge.service";
import type {
  CriterionGrade,
  RubricCriterion,
} from "../types/criterion-evidence.types";

describe("CriterionJudgeService", () => {
  const buildSubject = () => {
    const processPromptForFeature = jest.fn().mockResolvedValue(
      JSON.stringify({
        approved: true,
        issues: [],
        summary: "ok",
      }),
    );
    const promptProcessor = { processPromptForFeature } as any;

    const llmResolver = {
      getModelForValidationTask: jest.fn().mockResolvedValue("gpt-4o-mini"),
    } as any;

    const service = new CriterionJudgeService(promptProcessor, llmResolver);
    return { service, processPromptForFeature, llmResolver };
  };

  const criterion: RubricCriterion = {
    id: "c1",
    rubricQuestion: "Criterion",
    description: "",
    criteria: [{ description: "Met", points: 4 }],
    maxPoints: 4,
  };

  const grade: CriterionGrade = {
    criterionId: "c1",
    pointsAwarded: 4,
    maxPoints: 4,
    rationale: "looks good",
    citations: ["chunk1"],
    attempt: 1,
    rubricMatch: "Met",
  };

  it("invokes the prompt processor with deterministic options (temperature=0, topP=1, fixed seed)", async () => {
    const { service, processPromptForFeature } = buildSubject();

    await service.judge({
      question: "q",
      criteria: [criterion],
      grades: [grade],
      evidence: [],
      assignmentId: 1,
    });

    expect(processPromptForFeature).toHaveBeenCalledTimes(1);
    const callOptions = processPromptForFeature.mock.calls[0][5];
    expect(callOptions).toEqual({
      temperature: 0,
      topP: 1,
      seed: expect.any(Number),
    });
  });

  it("uses the same seed across repeated judge calls", async () => {
    const { service, processPromptForFeature } = buildSubject();

    await service.judge({
      question: "q",
      criteria: [criterion],
      grades: [grade],
      evidence: [],
      assignmentId: 1,
    });
    await service.judge({
      question: "q",
      criteria: [criterion],
      grades: [grade],
      evidence: [],
      assignmentId: 1,
    });

    const seedA = processPromptForFeature.mock.calls[0][5].seed;
    const seedB = processPromptForFeature.mock.calls[1][5].seed;
    expect(seedA).toBe(seedB);
  });
});
