-- Standardize generation and translation on Luna 6. Keep old assignments and
-- record the previous default/active assignments for an explicit rollback.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LLMModel" WHERE "modelKey" = 'gpt-6-luna' AND "isActive") THEN
    RAISE EXCEPTION 'GPT-6 Luna must be registered and active before switching features';
  END IF;
END $$;

INSERT INTO "LLMFeatureAssignment" AS existing
  ("featureId", "modelId", "isActive", priority, "assignedBy", "assignedAt", metadata)
SELECT feature.id, target.id, true,
  COALESCE((SELECT MAX(a.priority) FROM "LLMFeatureAssignment" a
    WHERE a."featureId" = feature.id AND a."isActive"), 100),
  'migration', NOW(), jsonb_build_object(
    'migration', '20260922220000_use_luna_for_generation_and_translation',
    'previousDefaultModelKey', feature."defaultModelKey",
    'previousActiveAssignmentIds', COALESCE((
      SELECT jsonb_agg(a.id ORDER BY a.id) FROM "LLMFeatureAssignment" a
      WHERE a."featureId" = feature.id AND a."isActive"
    ), '[]'::jsonb))
FROM "AIFeature" feature
JOIN "LLMModel" target ON target."modelKey" = 'gpt-6-luna'
WHERE feature."featureKey" IN
  ('assignment_generation', 'question_generation', 'rubric_generation', 'translation')
ON CONFLICT ("featureId", "modelId") DO UPDATE SET
  "isActive" = true, "deactivatedAt" = NULL, priority = EXCLUDED.priority,
  "assignedAt" = CASE WHEN existing."isActive" THEN existing."assignedAt" ELSE EXCLUDED."assignedAt" END,
  metadata = CASE
    WHEN existing.metadata->>'migration' = '20260922220000_use_luna_for_generation_and_translation'
      THEN existing.metadata
    ELSE COALESCE(existing.metadata, '{}'::jsonb) || EXCLUDED.metadata
  END;

UPDATE "LLMFeatureAssignment" a SET "isActive" = false, "deactivatedAt" = NOW()
FROM "AIFeature" feature, "LLMModel" model
WHERE a."featureId" = feature.id AND a."modelId" = model.id AND a."isActive"
  AND model."modelKey" <> 'gpt-6-luna'
  AND feature."featureKey" IN
    ('assignment_generation', 'question_generation', 'rubric_generation', 'translation');

UPDATE "AIFeature" SET "defaultModelKey" = 'gpt-6-luna', "updatedAt" = NOW()
WHERE "featureKey" IN
  ('assignment_generation', 'question_generation', 'rubric_generation', 'translation')
  AND "defaultModelKey" IS DISTINCT FROM 'gpt-6-luna';
COMMIT;
