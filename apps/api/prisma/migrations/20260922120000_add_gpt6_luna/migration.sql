-- Register Luna 6 without removing the Luna 5.6 rollback target.
-- USD/token, Standard processing, verified 2026-09-22:
-- https://developers.openai.com/api/docs/models/gpt-6-luna
INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt")
VALUES ('gpt-6-luna', 'GPT-6 Luna', 'OpenAI', true, NOW(), NOW())
ON CONFLICT ("modelKey") DO UPDATE SET
  "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = NOW();

INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "metadata", "createdAt", "updatedAt")
SELECT id, 0.0000001, 0.0000005, NOW(), 'MANUAL', true,
  jsonb_build_object(
    'pricingDate', '2026-09-22',
    'source', 'https://developers.openai.com/api/docs/models/gpt-6-luna',
    'snapshot', false,
    'tier', 'short_context',
    'cachedInputTokenPrice', 0.00000001,
    'cacheWriteTokenPrice', 0.000000125,
    'longContextInputThresholdTokens', 272000,
    'longContextInputTokenPrice', 0.0000002,
    'longContextCachedInputTokenPrice', 0.00000002,
    'longContextCacheWriteTokenPrice', 0.00000025,
    'longContextOutputTokenPrice', 0.00000075
  ), NOW(), NOW()
FROM "LLMModel" m WHERE "modelKey" = 'gpt-6-luna'
AND NOT EXISTS (SELECT 1 FROM "LLMPricing" p WHERE p."modelId" = m.id AND p."isActive");
