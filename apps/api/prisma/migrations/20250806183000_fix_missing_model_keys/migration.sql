-- Fix missing model keys in AIUsage table based on usage type patterns
-- This addresses the warnings about missing model keys in the cost calculation

-- Update records with translation usage type to use gpt-4o-mini
UPDATE "AIUsage" 
SET "modelKey" = 'gpt-4o-mini', "updatedAt" = NOW()
WHERE "modelKey" IS NULL 
  AND "usageType" = 'TRANSLATION';

-- Update records with live recording feedback to use gpt-4o-mini
UPDATE "AIUsage" 
SET "modelKey" = 'gpt-4o-mini', "updatedAt" = NOW()
WHERE "modelKey" IS NULL 
  AND "usageType" = 'LIVE_RECORDING_FEEDBACK';

-- Update records with grading usage type to use gpt-4o
UPDATE "AIUsage" 
SET "modelKey" = 'gpt-4o', "updatedAt" = NOW()
WHERE "modelKey" IS NULL 
  AND "usageType" = 'ASSIGNMENT_GRADING';

-- Update records with generation usage types to use gpt-4o
UPDATE "AIUsage" 
SET "modelKey" = 'gpt-4o', "updatedAt" = NOW()
WHERE "modelKey" IS NULL 
  AND ("usageType" = 'QUESTION_GENERATION'
       OR "usageType" = 'ASSIGNMENT_GENERATION');

-- Update any remaining records without model keys to use gpt-4o-mini as default
UPDATE "AIUsage" 
SET "modelKey" = 'gpt-4o-mini', "updatedAt" = NOW()
WHERE "modelKey" IS NULL;