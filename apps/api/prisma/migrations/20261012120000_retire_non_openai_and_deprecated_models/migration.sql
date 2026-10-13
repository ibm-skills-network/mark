-- Retire models the API no longer ships a provider for: every non-OpenAI
-- model, plus OpenAI models on the deprecation schedule
-- (https://developers.openai.com/api/docs/deprecations, checked 2026-10-12):
-- gpt-5, gpt-5-mini and gpt-5-nano (2025-08-07 snapshots, shutdown
-- 2026-12-11) and gpt-5.4-nano (shutdown 2027-04-01).
--
-- Rows are deactivated, never deleted. LLMPricing and LLMFeatureAssignment
-- both cascade on LLMModel delete, and admin cost reports price historical
-- AIUsage rows by modelKey through that pricing history.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "LLMModel" WHERE "modelKey" = 'gpt-6-luna' AND "isActive"
  ) THEN
    RAISE EXCEPTION 'GPT-6 Luna must be registered and active before retiring models';
  END IF;
END $$;

-- Give every feature that routes to a retired model a Luna 6 assignment in
-- the same priority slot, recording what it replaced for rollback/audit.
INSERT INTO "LLMFeatureAssignment" AS existing
  ("featureId", "modelId", "isActive", priority, "assignedBy", "assignedAt", metadata)
SELECT a."featureId", target.id, true, MAX(a.priority), 'migration', NOW(),
  jsonb_build_object(
    'migration', '20261012120000_retire_non_openai_and_deprecated_models',
    'replacedAssignmentIds', jsonb_agg(a.id ORDER BY a.id),
    'replacedModelKeys', jsonb_agg(DISTINCT retired."modelKey"))
FROM "LLMFeatureAssignment" a
JOIN "LLMModel" retired ON retired.id = a."modelId"
JOIN "LLMModel" target ON target."modelKey" = 'gpt-6-luna'
WHERE a."isActive"
  AND retired."modelKey" IN (
    'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.4-nano-2026-03-17',
    'gpt-oss-120b', 'granite-4-h-small', 'granite-vision-3-2-2b',
    'llama-3-3-70b-instruct', 'llama-4-maverick', 'mistral-medium-2505')
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
FROM "LLMModel" m
WHERE a."modelId" = m.id AND a."isActive"
  AND m."modelKey" IN (
    'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.4-nano-2026-03-17',
    'gpt-oss-120b', 'granite-4-h-small', 'granite-vision-3-2-2b',
    'llama-3-3-70b-instruct', 'llama-4-maverick', 'mistral-medium-2505');

UPDATE "AIFeature" SET "defaultModelKey" = 'gpt-6-luna', "updatedAt" = NOW()
WHERE "defaultModelKey" IN (
  'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.4-nano-2026-03-17',
  'gpt-oss-120b', 'granite-4-h-small', 'granite-vision-3-2-2b',
  'llama-3-3-70b-instruct', 'llama-4-maverick', 'mistral-medium-2505');

-- Inactive models drop out of the admin picker, are refused by
-- LLMAssignmentService.assignModelToFeature, and are skipped by the pricing
-- refresh; their pricing and assignment history stays intact.
UPDATE "LLMModel" SET "isActive" = false, "updatedAt" = NOW()
WHERE "isActive" AND "modelKey" IN (
  'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.4-nano-2026-03-17',
  'gpt-oss-120b', 'granite-4-h-small', 'granite-vision-3-2-2b',
  'llama-3-3-70b-instruct', 'llama-4-maverick', 'mistral-medium-2505');
COMMIT;
