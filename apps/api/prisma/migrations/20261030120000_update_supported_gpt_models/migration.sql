-- Keep retired model/pricing rows for historical usage reports.
-- Standard USD/token rates verified 2026-10-30:
-- https://developers.openai.com/api/docs/models
-- https://developers.openai.com/api/docs/models/gpt-6.1-terra
-- https://developers.openai.com/api/docs/models/gpt-6.1-sol
BEGIN;

INSERT INTO "LLMModel" ("modelKey", "displayName", provider, "isActive", "createdAt", "updatedAt")
VALUES
  ('gpt-6.1-terra', 'GPT-6.1 Terra', 'OpenAI', true, NOW(), NOW()),
  ('gpt-6.1-sol', 'GPT-6.1 Sol', 'OpenAI', true, NOW(), NOW())
ON CONFLICT ("modelKey") DO UPDATE SET
  "displayName" = EXCLUDED."displayName", provider = EXCLUDED.provider,
  "isActive" = true, "updatedAt" = NOW();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "LLMModel" WHERE "modelKey" = 'gpt-6-luna' AND "isActive"
  ) THEN
    RAISE EXCEPTION 'GPT-6 Luna must be registered and active before retiring models';
  END IF;
END $$;

INSERT INTO "LLMPricing"
  ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", source,
   "isActive", metadata, "createdAt", "updatedAt")
SELECT m.id, rates.input, rates.output, NOW(), 'MANUAL', true,
  jsonb_build_object(
    'pricingDate', '2026-10-30',
    'source', 'https://developers.openai.com/api/docs/models/' || m."modelKey",
    'tier', 'short_context',
    'cachedInputTokenPrice', rates.input * 0.05,
    'cacheWriteTokenPrice', rates.input * 1.25,
    'longContextInputThresholdTokens', 272000,
    'longContextInputTokenPrice', rates.input * 2,
    'longContextCachedInputTokenPrice', rates.input * 0.1,
    'longContextCacheWriteTokenPrice', rates.input * 2.5,
    'longContextOutputTokenPrice', rates.output * 1.5
  ), NOW(), NOW()
FROM "LLMModel" m
JOIN (VALUES
  ('gpt-6.1-terra', 0.000001, 0.000005),
  ('gpt-6.1-sol', 0.000002, 0.00001)
) AS rates(key, input, output) ON rates.key = m."modelKey"
WHERE NOT EXISTS (
  SELECT 1 FROM "LLMPricing" p WHERE p."modelId" = m.id AND p."isActive"
);

-- Map old tiers to their successors. Remaining GPT-4/5.4 selections use Luna.
CREATE TEMP TABLE retired_model_replacements ON COMMIT DROP AS
SELECT "modelKey" AS old_key,
  CASE "modelKey"
    WHEN 'gpt-5.6-terra' THEN 'gpt-6.1-terra'
    WHEN 'gpt-5.6-sol' THEN 'gpt-6.1-sol'
    ELSE 'gpt-6-luna'
  END AS new_key
FROM "LLMModel"
WHERE "modelKey" LIKE 'gpt-4%'
  OR "modelKey" LIKE 'gpt-5.4%'
  OR "modelKey" IN ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol');

INSERT INTO "LLMFeatureAssignment" AS existing
  ("featureId", "modelId", "isActive", priority, "assignedBy", "assignedAt", metadata)
SELECT a."featureId", target.id, true, MAX(a.priority), 'migration', NOW(),
  jsonb_build_object(
    'migration', '20261030120000_update_supported_gpt_models',
    'replacedAssignmentIds', jsonb_agg(a.id ORDER BY a.id),
    'replacedModelKeys', jsonb_agg(DISTINCT retired."modelKey"))
FROM "LLMFeatureAssignment" a
JOIN "LLMModel" retired ON retired.id = a."modelId"
JOIN retired_model_replacements r ON r.old_key = retired."modelKey"
JOIN "LLMModel" target ON target."modelKey" = r.new_key
WHERE a."isActive"
GROUP BY a."featureId", target.id
ON CONFLICT ("featureId", "modelId") DO UPDATE SET
  "isActive" = true,
  "deactivatedAt" = NULL,
  priority = CASE WHEN existing."isActive"
    THEN GREATEST(existing.priority, EXCLUDED.priority)
    ELSE EXCLUDED.priority END,
  "assignedAt" = CASE WHEN existing."isActive"
    THEN existing."assignedAt" ELSE EXCLUDED."assignedAt" END,
  "assignedBy" = CASE WHEN existing."isActive"
    THEN existing."assignedBy" ELSE EXCLUDED."assignedBy" END,
  metadata = COALESCE(existing.metadata, '{}'::jsonb) || EXCLUDED.metadata;

UPDATE "LLMFeatureAssignment" a SET "isActive" = false, "deactivatedAt" = NOW()
FROM "LLMModel" m, retired_model_replacements r
WHERE a."modelId" = m.id AND m."modelKey" = r.old_key AND a."isActive";

-- Defaults can refer to a key even if no corresponding LLMModel row exists.
UPDATE "AIFeature" SET "defaultModelKey" = CASE "defaultModelKey"
    WHEN 'gpt-5.6-terra' THEN 'gpt-6.1-terra'
    WHEN 'gpt-5.6-sol' THEN 'gpt-6.1-sol'
    ELSE 'gpt-6-luna'
  END, "updatedAt" = NOW()
WHERE "defaultModelKey" LIKE 'gpt-4%'
  OR "defaultModelKey" LIKE 'gpt-5.4%'
  OR "defaultModelKey" IN ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol');

UPDATE "LLMModel" m SET "isActive" = false, "updatedAt" = NOW()
FROM retired_model_replacements r
WHERE m."modelKey" = r.old_key AND m."isActive";

COMMIT;
