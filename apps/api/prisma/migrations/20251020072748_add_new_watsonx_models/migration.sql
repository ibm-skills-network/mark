-- Add new WatsonX AI models to the LLMModel table
-- This migration adds Granite, Llama 3.3, Llama 4 Maverick, and Mistral Medium models

INSERT INTO "LLMModel" ("modelKey", "displayName", "provider", "isActive", "createdAt", "updatedAt") VALUES
('granite-4-h-small', 'Granite 4-H Small', 'IBM', true, NOW(), NOW()),
('llama-3-3-70b-instruct', 'Llama 3.3 70B Instruct', 'Meta', true, NOW(), NOW()),
('llama-4-maverick', 'Llama 4 Maverick 17B', 'Meta', true, NOW(), NOW()),
('mistral-medium-2505', 'Mistral Medium 2505', 'Mistral AI', true, NOW(), NOW());

-- Add initial pricing data for the new models
-- Note: Pricing based on WatsonX Resource Unit (RU) model where 1 RU = 1,000 tokens
-- Granite models (Class 1): $0.0006/RU = $0.0000006 per token
-- Llama/Mistral models (Class 2): $0.0018/RU = $0.0000018 per token
-- Input and output tokens are charged at the same rate in WatsonX
WITH new_models AS (
  SELECT id, "modelKey" FROM "LLMModel" WHERE "modelKey" IN (
    'granite-4-h-small',
    'llama-3-3-70b-instruct',
    'llama-4-maverick',
    'mistral-medium-2505'
  )
)
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "createdAt", "updatedAt")
SELECT
  m.id,
  CASE
    WHEN m."modelKey" = 'granite-4-h-small' THEN 0.0000006
    WHEN m."modelKey" = 'llama-3-3-70b-instruct' THEN 0.0000018
    WHEN m."modelKey" = 'llama-4-maverick' THEN 0.0000018
    WHEN m."modelKey" = 'mistral-medium-2505' THEN 0.0000018
  END,
  CASE
    WHEN m."modelKey" = 'granite-4-h-small' THEN 0.0000006
    WHEN m."modelKey" = 'llama-3-3-70b-instruct' THEN 0.0000018
    WHEN m."modelKey" = 'llama-4-maverick' THEN 0.0000018
    WHEN m."modelKey" = 'mistral-medium-2505' THEN 0.0000018
  END,
  NOW(),
  'MANUAL',
  true,
  NOW(),
  NOW()
FROM new_models m;
