-- Add Granite Vision 3.2 2B model to the LLMModel table
-- This migration adds IBM's multimodal Granite Vision model for image grading

INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('granite-vision-3-2-2b', 'Granite Vision 3.2 2B', 'IBM', true, NOW(), NOW());

-- Add initial pricing data for the Granite Vision model
-- Note: Pricing based on WatsonX vision model rates
-- Vision models typically cost more than text-only models due to image processing
WITH new_model AS (
  SELECT id, "modelKey" FROM "LLMModel" WHERE "modelKey" = 'granite-vision-3-2-2b'
)
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "createdAt", "updatedAt")
SELECT
  m.id,
  0.000001,  -- Input token price (slightly higher than granite-4-h-small due to vision capability)
  0.000001,  -- Output token price (same as input for vision models)
  NOW(),
  'MANUAL',
  true,
  NOW(),
  NOW()
FROM new_model m;
