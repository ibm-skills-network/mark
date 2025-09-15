-- Fix LLMFeatureAssignment uniqueness constraint and update default assignments

-- First, remove any duplicate feature-model pairs (keep only the active one)
DELETE FROM "LLMFeatureAssignment" a
WHERE EXISTS (
  SELECT 1 
  FROM "LLMFeatureAssignment" b 
  WHERE b."featureId" = a."featureId" 
    AND b."modelId" = a."modelId" 
    AND b.id < a.id
);

-- Drop the old constraint if it exists
DROP INDEX IF EXISTS "LLMFeatureAssignment_featureId_modelId_isActive_key";

-- Drop the new constraint if it already exists (in case of re-run)
DROP INDEX IF EXISTS "LLMFeatureAssignment_featureId_modelId_key";

-- Create the new unique constraint
CREATE UNIQUE INDEX "LLMFeatureAssignment_featureId_modelId_key" ON "LLMFeatureAssignment"("featureId", "modelId");

-- Now delete all assignments to start fresh
DELETE FROM "LLMFeatureAssignment";

-- All text-based grading features will use gpt-5-mini
-- Note: Grading validation/judge is handled at the service level, not as a separate AIFeature
INSERT INTO "LLMFeatureAssignment" ("featureId", "modelId", "isActive", "priority", "assignedBy", "assignedAt", "metadata")
SELECT 
  f.id as featureId,
  m.id as modelId,
  true as isActive,
  100 as priority,
  'system' as assignedBy,
  NOW() as assignedAt,
  jsonb_build_object(
    'assignmentType', 'default',
    'reason', 'Updated default assignments: gpt-5-mini for text grading'
  ) as metadata
FROM "AIFeature" f
CROSS JOIN "LLMModel" m
WHERE 
  -- Text-based grading features use gpt-5-mini
  (f."featureType" IN ('TEXT_GRADING', 'FILE_GRADING', 'URL_GRADING', 'LIVE_RECORDING_FEEDBACK') 
   AND m."modelKey" = 'gpt-5-mini') OR
  
  -- Vision-capable grading features still use gpt-4.1-mini (vision model)
  (f."featureType" IN ('IMAGE_GRADING', 'PRESENTATION_GRADING', 'VIDEO_GRADING') 
   AND m."modelKey" = 'gpt-4.1-mini') OR
  
  -- Translation uses gpt-4o-mini (keep existing default)
  (f."featureType" = 'TRANSLATION' AND m."modelKey" = 'gpt-4o-mini') OR
  
  -- Generation features use gpt-4o (keep existing default)
  (f."featureType" IN ('QUESTION_GENERATION', 'RUBRIC_GENERATION', 'ASSIGNMENT_GENERATION') 
   AND m."modelKey" = 'gpt-4o') OR
  
  -- Content moderation uses gpt-4o-mini (keep existing default)
  (f."featureType" = 'CONTENT_MODERATION' AND m."modelKey" = 'gpt-4o-mini');