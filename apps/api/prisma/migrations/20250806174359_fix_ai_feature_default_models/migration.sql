-- Fix default model assignments in AIFeature table
-- Update to match the requirement: gpt-4o for everything except translation (gpt-4o-mini) and images (gpt-4.1-mini)

UPDATE "AIFeature" SET 
  "defaultModelKey" = 'gpt-4o',
  "updatedAt" = NOW()
WHERE "featureType" NOT IN ('TRANSLATION', 'IMAGE_GRADING') 
  AND "defaultModelKey" != 'gpt-4o';

UPDATE "AIFeature" SET 
  "defaultModelKey" = 'gpt-4o-mini',
  "updatedAt" = NOW()
WHERE "featureType" = 'TRANSLATION' 
  AND "defaultModelKey" != 'gpt-4o-mini';

UPDATE "AIFeature" SET 
  "defaultModelKey" = 'gpt-4.1-mini',
  "updatedAt" = NOW()
WHERE "featureType" = 'IMAGE_GRADING' 
  AND "defaultModelKey" != 'gpt-4.1-mini';