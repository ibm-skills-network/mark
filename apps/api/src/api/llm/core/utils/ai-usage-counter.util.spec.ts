import {
  toAiUsageCounterBigInt,
  toAiUsageCounterNumber,
} from "./ai-usage-counter.util";

describe("ai-usage-counter.util", () => {
  it("converts safe integers to bigint for persistence", () => {
    expect(toAiUsageCounterBigInt(42, "tokensIn")).toBe(BigInt(42));
  });

  it("converts bigint counters back to numbers for API responses", () => {
    expect(toAiUsageCounterNumber(BigInt(42), "tokensOut")).toBe(42);
  });

  it("rejects bigint values that cannot be serialized safely as numbers", () => {
    expect(() =>
      toAiUsageCounterNumber(
        BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
        "usageCount",
      ),
    ).toThrow("usageCount exceeds Number.MAX_SAFE_INTEGER");
  });
});
