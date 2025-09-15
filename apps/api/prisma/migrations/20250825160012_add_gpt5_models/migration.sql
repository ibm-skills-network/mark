-- Add GPT-5 model variants to the LLMModel table
-- This migration adds GPT-5, GPT-5-mini, and GPT-5-nano models

INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('gpt-5', 'GPT-5', 'OpenAI', true, NOW(), NOW()),
('gpt-5-mini', 'GPT-5 Mini', 'OpenAI', true, NOW(), NOW()),
('gpt-5-nano', 'GPT-5 Nano', 'OpenAI', true, NOW(), NOW());

-- Add initial pricing data for the new GPT-5 models
-- Note: These are estimated prices, adjust based on actual OpenAI pricing when available
WITH new_models AS (
  SELECT id, "modelKey" FROM "LLMModel" WHERE "modelKey" IN ('gpt-5', 'gpt-5-mini', 'gpt-5-nano')
)
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "createdAt", "updatedAt")
SELECT 
  m.id,
  CASE 
    WHEN m."modelKey" = 'gpt-5' THEN 0.000005        -- Estimated: Higher than GPT-4o
    WHEN m."modelKey" = 'gpt-5-mini' THEN 0.0000003  -- Estimated: Lower than GPT-4o-mini
    WHEN m."modelKey" = 'gpt-5-nano' THEN 0.0000001  -- Estimated: Very low for nano version
  END,
  CASE 
    WHEN m."modelKey" = 'gpt-5' THEN 0.000015        -- Estimated: Higher than GPT-4o
    WHEN m."modelKey" = 'gpt-5-mini' THEN 0.0000012  -- Estimated: Lower than GPT-4o-mini  
    WHEN m."modelKey" = 'gpt-5-nano' THEN 0.0000004  -- Estimated: Very low for nano version
  END,
  NOW(),
  'MANUAL',
  true,
  NOW(),
  NOW()
FROM new_models m;