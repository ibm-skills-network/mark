-- Add AI feature keys for criterion-level grading pipeline

INSERT INTO "AIFeature" (
  "featureKey",
  "featureType",
  "displayName",
  "description",
  "isActive",
  "requiresModel",
  "defaultModelKey",
  "createdAt",
  "updatedAt"
) VALUES
  (
    'evidence_validation',
    'TEXT_GRADING',
    'Evidence Validation',
    'Validate evidence chunks for criterion grading',
    true,
    true,
    'gpt-5-nano',
    NOW(),
    NOW()
  ),
  (
    'criterion_grading',
    'TEXT_GRADING',
    'Criterion Grading',
    'Grade a single rubric criterion using evidence chunks',
    true,
    true,
    'gpt-5-mini',
    NOW(),
    NOW()
  ),
  (
    'criterion_judge',
    'TEXT_GRADING',
    'Criterion Judge',
    'Judge criterion grading output for evidence alignment',
    true,
    true,
    'gpt-5-mini',
    NOW(),
    NOW()
  )
ON CONFLICT ("featureKey") DO NOTHING;

WITH feature_ids AS (
  SELECT id, "featureKey"
  FROM "AIFeature"
  WHERE "featureKey" IN (
    'evidence_validation',
    'criterion_grading',
    'criterion_judge'
  )
),
model_ids AS (
  SELECT id, "modelKey"
  FROM "LLMModel"
  WHERE "modelKey" IN ('gpt-5-nano', 'gpt-5-mini')
)
INSERT INTO "LLMFeatureAssignment" (
  "featureId",
  "modelId",
  "isActive",
  "priority",
  "assignedBy",
  "assignedAt",
  "metadata"
)
SELECT
  f.id,
  m.id,
  true,
  100,
  'system',
  NOW(),
  jsonb_build_object(
    'assignmentType', 'default',
    'reason', 'Criterion-level grading defaults'
  )
FROM feature_ids f
JOIN model_ids m
  ON (
    f."featureKey" = 'evidence_validation' AND m."modelKey" = 'gpt-5-nano'
  ) OR (
    f."featureKey" IN ('criterion_grading', 'criterion_judge')
    AND m."modelKey" = 'gpt-5-mini'
  )
ON CONFLICT ("featureId", "modelId") DO NOTHING;
