-- Upgrade only features already using Luna 5.6; retain other model tiers,
-- priorities and the old assignment rows for rollback/audit.
BEGIN;
INSERT INTO "LLMFeatureAssignment"
  ("featureId", "modelId", "isActive", "priority", "assignedBy", "assignedAt", "metadata")
SELECT a."featureId", target.id, true, a.priority, a."assignedBy", NOW(),
  COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object(
    'migration', '20260922121000_switch_luna_assignments',
    'previousModelKey', 'gpt-5.6-luna', 'previousAssignmentId', a.id,
    'previousDefaultModelKey', feature."defaultModelKey")
FROM "LLMFeatureAssignment" a
JOIN "AIFeature" feature ON feature.id = a."featureId"
JOIN "LLMModel" old ON old.id = a."modelId" AND old."modelKey" = 'gpt-5.6-luna'
JOIN "LLMModel" target ON target."modelKey" = 'gpt-6-luna'
WHERE a."isActive"
ON CONFLICT ("featureId", "modelId") DO UPDATE SET
  "isActive" = true, "deactivatedAt" = NULL,
  "priority" = EXCLUDED."priority", "assignedAt" = EXCLUDED."assignedAt",
  "metadata" = EXCLUDED."metadata";

-- Set the default for features currently led by Luna 5.6 as well as any
-- explicit Luna 5.6 defaults. A higher-priority assignment to another tier
-- does not change its default merely because Luna was a fallback.
UPDATE "AIFeature" feature SET "defaultModelKey" = 'gpt-6-luna', "updatedAt" = NOW()
WHERE feature."defaultModelKey" = 'gpt-5.6-luna'
OR EXISTS (
  SELECT 1 FROM "LLMFeatureAssignment" a
  JOIN "LLMModel" old ON old.id = a."modelId"
  WHERE a."featureId" = feature.id AND a."isActive"
    AND old."modelKey" = 'gpt-5.6-luna'
    AND NOT EXISTS (
      SELECT 1 FROM "LLMFeatureAssignment" preferred
      WHERE preferred."featureId" = a."featureId" AND preferred."isActive"
        AND preferred.priority > a.priority
    )
);

UPDATE "LLMFeatureAssignment" a SET "isActive" = false, "deactivatedAt" = NOW()
FROM "LLMModel" m WHERE a."modelId" = m.id
AND m."modelKey" = 'gpt-5.6-luna' AND a."isActive";
COMMIT;
