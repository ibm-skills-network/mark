import { PricingSource } from "@prisma/client";

import { LLMPricingService, type ModelPricing } from "./llm-pricing.service";

// Refresh sources only know input and output prices, so this pins the metadata carry-forward that keeps seeded cached rates alive.
describe("LLMPricingService.updatePricingHistory", () => {
  it("keeps the seeded cached-input rate when the refresh does not supply one", async () => {
    const prisma = {
      lLMModel: { findUnique: jest.fn().mockResolvedValue({ id: 7 }) },
      lLMPricing: {
        // First call looks for a same-day duplicate, second reads the active row.
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            metadata: {
              cachedInputTokenPrice: 0.000_000_25,
              cacheWriteTokenPrice: 0.000_002_5,
            },
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const refreshed: ModelPricing = {
      modelKey: "gpt-5",
      inputTokenPrice: 0.000_002,
      outputTokenPrice: 0.000_008,
      effectiveDate: new Date("2026-09-01T00:00:00.000Z"),
      source: PricingSource.WEB_SCRAPING,
      metadata: { pricingSource: "helicone_registry" },
    };

    const service = new LLMPricingService(prisma as never, {} as never);

    expect(await service.updatePricingHistory([refreshed])).toBe(1);
    expect(prisma.lLMPricing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputTokenPrice: 0.000_002,
        metadata: {
          cachedInputTokenPrice: 0.000_000_25,
          cacheWriteTokenPrice: 0.000_002_5,
          pricingSource: "helicone_registry",
        },
      }),
    });
  });
});
