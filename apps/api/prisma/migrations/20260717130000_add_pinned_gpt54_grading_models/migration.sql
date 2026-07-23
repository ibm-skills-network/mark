INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('gpt-5.4-mini-2026-03-17', 'GPT-5.4 Mini (2026-03-17 pinned)', 'OpenAI', true, NOW(), NOW()),
('gpt-5.4-nano-2026-03-17', 'GPT-5.4 Nano (2026-03-17 pinned)', 'OpenAI', true, NOW(), NOW())
ON CONFLICT ("modelKey") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "provider" = EXCLUDED."provider",
  "isActive" = true,
  "updatedAt" = NOW();

INSERT INTO "AIFeature" ("featureKey", "featureType", "displayName", "description", "isActive", "requiresModel", "defaultModelKey", "createdAt", "updatedAt") VALUES
('file_evidence_grading', 'FILE_GRADING', 'Structured File and Code Grading', 'Evidence-based grading for structured file and code uploads', true, true, 'gpt-5.4-mini-2026-03-17', NOW(), NOW())
ON CONFLICT ("featureKey") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "description" = EXCLUDED."description",
  "isActive" = true,
  "requiresModel" = true,
  "defaultModelKey" = EXCLUDED."defaultModelKey",
  "updatedAt" = NOW();

WITH pinned_models AS (
  SELECT id, "modelKey" FROM "LLMModel"
  WHERE "modelKey" IN (
    'gpt-5.4-mini-2026-03-17',
    'gpt-5.4-nano-2026-03-17'
  )
)
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "metadata", "createdAt", "updatedAt")
SELECT
  model.id,
  CASE
    WHEN model."modelKey" = 'gpt-5.4-mini-2026-03-17' THEN 0.00000075
    ELSE 0.00000020
  END,
  CASE
    WHEN model."modelKey" = 'gpt-5.4-mini-2026-03-17' THEN 0.00000450
    ELSE 0.00000125
  END,
  NOW(),
  'MANUAL',
  true,
  jsonb_build_object('snapshot', true, 'pricingDate', '2026-07-17'),
  NOW(),
  NOW()
FROM pinned_models model;
