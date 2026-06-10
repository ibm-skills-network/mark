import { PricingSource } from "@prisma/client";

import { LLMPricingService, type ModelPricing } from "./llm-pricing.service";

/**
 * Focused unit tests for LLMPricingService.calculateCostBatch.
 *
 * The batch path is the new hot path for admin analytics aggregates, so the
 * behaviour that matters is: (1) cost math matches per-row pricing, (2) pricing
 * lookups are deduped by (modelKey, calendar-day), and (3) a missing price for
 * a row yields `null` for that row rather than throwing or poisoning the rest.
 *
 * getPricingAtDate / getCurrentPriceUpscaling are spied so no DB is touched;
 * upscaling is null, which makes applyPricing fall through to base prices and
 * keeps the expected costs exact.
 */
describe("LLMPricingService.calculateCostBatch", () => {
  let service: LLMPricingService;

  const pricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
    modelKey: "gpt-4o",
    inputTokenPrice: 0.001,
    outputTokenPrice: 0.002,
    effectiveDate: new Date("2026-01-01T00:00:00.000Z"),
    source: PricingSource.MANUAL,
    ...overrides,
  });

  beforeEach(() => {
    // Constructor only stores the deps; every method we exercise is spied.
    service = new LLMPricingService({} as never, {} as never);
    jest
      .spyOn(service, "getCurrentPriceUpscaling")
      .mockResolvedValue(null as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it("returns an empty array without touching pricing for no records", async () => {
    const pricingSpy = jest.spyOn(service, "getPricingAtDate");
    const upscalingSpy = jest.spyOn(service, "getCurrentPriceUpscaling");

    expect(await service.calculateCostBatch([])).toEqual([]);
    expect(pricingSpy).not.toHaveBeenCalled();
    expect(upscalingSpy).not.toHaveBeenCalled();
  });

  it("computes per-row cost from base pricing (no upscaling)", async () => {
    jest.spyOn(service, "getPricingAtDate").mockResolvedValue(pricing());

    const [result] = await service.calculateCostBatch([
      {
        modelKey: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        usageDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    // 1000 * 0.001 + 500 * 0.002 = 1 + 1 = 2
    expect(result).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      inputCost: 1,
      outputCost: 1,
      totalCost: 2,
      modelKey: "gpt-4o",
      inputTokenPrice: 0.001,
      outputTokenPrice: 0.002,
    });
  });

  it("looks pricing up once per (modelKey, calendar-day)", async () => {
    const pricingSpy = jest
      .spyOn(service, "getPricingAtDate")
      .mockResolvedValue(pricing());

    await service.calculateCostBatch([
      // same model, same UTC day, different times -> one lookup
      {
        modelKey: "gpt-4o",
        inputTokens: 10,
        outputTokens: 10,
        usageDate: new Date("2026-01-01T01:00:00.000Z"),
      },
      {
        modelKey: "gpt-4o",
        inputTokens: 20,
        outputTokens: 20,
        usageDate: new Date("2026-01-01T23:00:00.000Z"),
      },
    ]);

    expect(pricingSpy).toHaveBeenCalledTimes(1);
  });

  it("looks pricing up separately per distinct day and per distinct model", async () => {
    const pricingSpy = jest
      .spyOn(service, "getPricingAtDate")
      .mockImplementation((modelKey) => Promise.resolve(pricing({ modelKey })));

    await service.calculateCostBatch([
      {
        modelKey: "gpt-4o",
        inputTokens: 1,
        outputTokens: 1,
        usageDate: new Date("2026-01-01T00:00:00.000Z"),
      },
      // same model, next day -> new lookup
      {
        modelKey: "gpt-4o",
        inputTokens: 1,
        outputTokens: 1,
        usageDate: new Date("2026-01-02T00:00:00.000Z"),
      },
      // different model, same day as the first -> new lookup (key includes model)
      {
        modelKey: "gpt-4o-mini",
        inputTokens: 1,
        outputTokens: 1,
        usageDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    expect(pricingSpy).toHaveBeenCalledTimes(3);
  });

  it("yields null for a row whose pricing is missing, without dropping others", async () => {
    jest
      .spyOn(service, "getPricingAtDate")
      .mockImplementation((modelKey) =>
        Promise.resolve(
          modelKey === "unpriced-model" ? null : pricing({ modelKey }),
        ),
      );

    const results = await service.calculateCostBatch([
      {
        modelKey: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 0,
        usageDate: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        modelKey: "unpriced-model",
        inputTokens: 1000,
        outputTokens: 1000,
        usageDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ totalCost: 1, modelKey: "gpt-4o" });
    expect(results[1]).toBeNull();
  });
});
