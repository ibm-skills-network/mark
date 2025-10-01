-- Add IBM foundation model variant to the LLMModel table
-- This migration adds the IBM foundation model GPT-oss-120b

INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('gpt-oss-120b', 'GPT-OSS-120B', 'OpenAI', true, NOW(), NOW());

-- Add initial pricing data for the new GPT model
-- Note: These are estimated prices, adjust based on actual OpenAI pricing when available
WITH new_models AS (
  SELECT id, "modelKey" FROM "LLMModel" WHERE "modelKey" IN ('gpt-oss-120b')
)
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "createdAt", "updatedAt")
SELECT 
  m.id,
  CASE 
    WHEN m."modelKey" = 'gpt-oss-120b' THEN 0.00000015
  END,
  CASE 
    WHEN m."modelKey" = 'gpt-oss-120b' THEN 0.0000006
  END,
  NOW(),
  'MANUAL',
  true,
  NOW(),
  NOW()
FROM new_models m;