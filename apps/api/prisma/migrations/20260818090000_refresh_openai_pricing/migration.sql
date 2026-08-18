-- Align every OpenAI model's active pricing row with the official
-- Standard-tier rates (https://developers.openai.com/api/docs/pricing,
-- 2026-08-18) and record the cached-input rate in metadata so cost math can
-- price cached tokens. Any active row whose prices differ or whose metadata
-- lacks cachedInputTokenPrice is deactivated and replaced; deactivated rows
-- are kept as history. A matching active row short-circuits both statements,
-- so re-running is a no-op, and the modelKey join skips models that do not
-- exist in a given environment. Prices are USD per single token.
CREATE TEMP TABLE openai_canon AS
SELECT * FROM (VALUES
  ('gpt-4o',                  0.0000025::numeric,  0.00000125::numeric,   0.00001::numeric,    false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-4o-mini',             0.00000015::numeric, 0.000000075::numeric,  0.0000006::numeric,  false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-4.1',                 0.000002::numeric,   0.0000005::numeric,    0.000008::numeric,   false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-4.1-mini',            0.0000004::numeric,  0.0000001::numeric,    0.0000016::numeric,  false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-4.1-nano',            0.0000001::numeric,  0.000000025::numeric,  0.0000004::numeric,  false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-5',                   0.00000125::numeric, 0.000000125::numeric,  0.00001::numeric,    false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-5-mini',              0.00000025::numeric, 0.000000025::numeric,  0.000002::numeric,   false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-5-nano',              0.00000005::numeric, 0.000000005::numeric,  0.0000004::numeric,  false, NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-5.4-mini-2026-03-17', 0.00000075::numeric, 0.000000075::numeric,  0.0000045::numeric,  true,  NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-5.4-nano-2026-03-17', 0.0000002::numeric,  0.00000002::numeric,   0.00000125::numeric, true,  NULL::numeric,      NULL::numeric,  NULL::numeric,       NULL::numeric,     NULL::numeric),
  ('gpt-5.6-luna',            0.0000002::numeric,  0.00000002::numeric,   0.0000012::numeric,  false, 0.00000025::numeric, 0.0000004::numeric, 0.00000004::numeric, 0.0000005::numeric, 0.0000018::numeric),
  ('gpt-5.6-terra',           0.000002::numeric,   0.0000002::numeric,    0.000012::numeric,   false, 0.0000025::numeric,  0.000004::numeric,  0.0000004::numeric,  0.000005::numeric,  0.000018::numeric),
  ('gpt-5.6-sol',             0.000005::numeric,   0.0000005::numeric,    0.00003::numeric,    false, 0.00000625::numeric, 0.00001::numeric,   0.000001::numeric,   0.0000125::numeric, 0.000045::numeric)
) AS t(model_key, in_price, cached_in, out_price, is_snapshot, cache_write, long_in, long_cached_in, long_cache_write, long_out);

UPDATE "LLMPricing" p
SET "isActive" = false, "updatedAt" = NOW()
FROM openai_canon c
JOIN "LLMModel" m ON m."modelKey" = c.model_key
WHERE p."modelId" = m.id
  AND p."isActive"
  AND NOT (
    p."inputTokenPrice"::numeric = c.in_price
    AND p."outputTokenPrice"::numeric = c.out_price
    AND (p.metadata ->> 'cachedInputTokenPrice') IS NOT NULL
    AND (p.metadata ->> 'cachedInputTokenPrice')::numeric = c.cached_in
  );

INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive", "metadata", "createdAt", "updatedAt")
SELECT
  m.id,
  c.in_price,
  c.out_price,
  NOW(),
  'MANUAL',
  true,
  jsonb_build_object(
    'pricingDate', '2026-08-18',
    'source', 'https://developers.openai.com/api/docs/pricing',
    'tier', 'standard',
    'snapshot', c.is_snapshot,
    'cachedInputTokenPrice', c.cached_in
  )
  -- Long-context rates apply above the input-token threshold; the pricing
  -- service selects them per request, so they must ride in metadata.
  || CASE WHEN c.long_in IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
    'tier', 'short_context',
    'cacheWriteTokenPrice', c.cache_write,
    'longContextInputTokenPrice', c.long_in,
    'longContextCachedInputTokenPrice', c.long_cached_in,
    'longContextCacheWriteTokenPrice', c.long_cache_write,
    'longContextOutputTokenPrice', c.long_out,
    'longContextInputThresholdTokens', 272000
  ) END,
  NOW(),
  NOW()
FROM openai_canon c
JOIN "LLMModel" m ON m."modelKey" = c.model_key
WHERE NOT EXISTS (
  SELECT 1 FROM "LLMPricing" p WHERE p."modelId" = m.id AND p."isActive"
);

DROP TABLE openai_canon;
