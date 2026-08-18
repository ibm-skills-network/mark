import { AnswerNormalizationService } from "./answer-normalization.service";

describe("AnswerNormalizationService.generateCacheKey", () => {
  const service = new AnswerNormalizationService();

  it("does not reuse a grade across different model identities", () => {
    const lunaKey = service.generateCacheKey(
      "rubric",
      "answer",
      42,
      "gpt-5.6-luna@rollout-1",
    );
    const solKey = service.generateCacheKey(
      "rubric",
      "answer",
      42,
      "gpt-5.6-sol@rollout-1",
    );

    expect(lunaKey).not.toBe(solKey);
  });

  it("does not reuse a rolling-model grade after a revision bump", () => {
    const before = service.generateCacheKey(
      "rubric",
      "answer",
      42,
      "gpt-5.6-luna@rollout-1",
    );
    const after = service.generateCacheKey(
      "rubric",
      "answer",
      42,
      "gpt-5.6-luna@rollout-2",
    );

    expect(before).not.toBe(after);
  });
});
