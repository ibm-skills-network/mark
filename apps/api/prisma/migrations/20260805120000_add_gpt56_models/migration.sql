-- Register GPT-5.6 (Luna, Terra, Sol) as assignable models.
-- Intentionally changes no AIFeature default or LLMFeatureAssignment row:
-- nothing routes here until it has been evaluated against real grading.
INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('gpt-5.6-luna', 'GPT-5.6 Luna', 'OpenAI', true, NOW(), NOW()),
('gpt-5.6-terra', 'GPT-5.6 Terra', 'OpenAI', true, NOW(), NOW()),
('gpt-5.6-sol', 'GPT-5.6 Sol', 'OpenAI', true, NOW(), NOW())
ON CONFLICT ("modelKey") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "provider" = EXCLUDED."provider",
  "isActive" = true,
  "updatedAt" = NOW();

-- Short-context pricing. Long-context and cache-write rates go in metadata;
-- LLMPricingService selects the long-context pair for requests above 272K.
WITH gpt56 AS (
  SELECT * FROM (VALUES
    ('gpt-5.6-luna',  0.00000020::numeric, 0.00000120::numeric, 0.00000040::numeric, 0.00000180::numeric, 0.00000025::numeric),
    ('gpt-5.6-terra', 0.00000200::numeric, 0.00001200::numeric, 0.00000400::numeric, 0.00001800::numeric, 0.00000250::numeric),
    ('gpt-5.6-sol',   0.00000500::numeric, 0.00003000::numeric, 0.00001000::numeric, 0.00004500::numeric, 0.00000625::numeric)
  ) AS t("modelKey", "inputPrice", "outputPrice", "longInputPrice", "longOutputPrice", "cacheWritePrice")
)
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "metadata", "createdAt", "updatedAt")
SELECT
  model.id,
  gpt56."inputPrice",
  gpt56."outputPrice",
  NOW(),
  'MANUAL',
  true,
  jsonb_build_object(
    'snapshot', false,
    'pricingDate', '2026-08-05',
    'tier', 'short_context',
    'longContextInputTokenPrice', gpt56."longInputPrice",
    'longContextOutputTokenPrice', gpt56."longOutputPrice",
    'longContextInputThresholdTokens', 272000,
    'cacheWriteTokenPrice', gpt56."cacheWritePrice"
  ),
  NOW(),
  NOW()
FROM gpt56
JOIN "LLMModel" model ON model."modelKey" = gpt56."modelKey"
WHERE NOT EXISTS (
  SELECT 1 FROM "LLMPricing" p WHERE p."modelId" = model.id AND p."isActive" = true
);
