-- Populate LLMFeatureAssignment table with default model assignments
-- Default assignments: gpt-4o for everything except translation (gpt-4o-mini) and images (gpt-4.1-mini)

INSERT INTO "LLMFeatureAssignment" ("featureId", "modelId", "isActive", "priority", "assignedBy", "assignedAt", "metadata")
SELECT 
  f.id as featureId,
  m.id as modelId,
  true as isActive,
  1 as priority,
  'system' as assignedBy,
  NOW() as assignedAt,
  jsonb_build_object(
    'assignmentType', 'default',
    'reason', 'Initial system assignment based on feature requirements'
  ) as metadata
FROM "AIFeature" f
CROSS JOIN "LLMModel" m
WHERE 
  -- Default assignments based on feature type
  (f."featureType" = 'TRANSLATION' AND m."modelKey" = 'gpt-4o-mini') OR
  (f."featureType" = 'IMAGE_GRADING' AND m."modelKey" = 'gpt-4.1-mini') OR
  (f."featureType" NOT IN ('TRANSLATION', 'IMAGE_GRADING') AND m."modelKey" = 'gpt-4o')
ON CONFLICT ("featureId", "modelId", "isActive") DO NOTHING;