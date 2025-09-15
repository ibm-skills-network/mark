# LLM Architecture Troubleshooting Guide

## Common Issues and Solutions

### 1. Model Assignment Issues

#### Problem: Feature shows "No model assigned" in admin interface

**Symptoms:**

- Admin interface shows empty or null assignments
- Features fall back to default models unexpectedly

**Diagnosis:**

```bash
# Check if assignments exist
psql $DATABASE_URL -c "
SELECT f.featureKey, f.displayName, m.modelKey, lfa.isActive
FROM \"AIFeature\" f
LEFT JOIN \"LLMFeatureAssignment\" lfa ON f.id = lfa.featureId AND lfa.isActive = true
LEFT JOIN \"LLMModel\" m ON lfa.modelId = m.id
ORDER BY f.featureKey;
"
```

**Solutions:**

1. Populate missing assignments:

```sql
-- Run the default assignment migration
INSERT INTO "LLMFeatureAssignment" ("featureId", "modelId", "isActive", "priority", "assignedBy")
SELECT f.id, m.id, true, 1, 'system'
FROM "AIFeature" f, "LLMModel" m
WHERE f.featureType = 'TEXT_GRADING' AND m.modelKey = 'gpt-4o'
ON CONFLICT DO NOTHING;
```

2. Check for inactive assignments:

```sql
UPDATE "LLMFeatureAssignment" SET isActive = true WHERE featureId = [FEATURE_ID];
```

#### Problem: Model resolution returns wrong model

**Symptoms:**

- Expected model not used for specific features
- Cache returning stale data

**Diagnosis:**

```typescript
// Check resolver service directly
const resolverService = app.get(LLM_RESOLVER_SERVICE);
const modelKey = await resolverService.resolveModelForFeature("text_grading");
console.log("Resolved model:", modelKey);
```

**Solutions:**

1. Clear cache:

```typescript
await resolverService.clearCache();
```

2. Check assignment priority:

```sql
-- Higher priority assignments take precedence
SELECT * FROM "LLMFeatureAssignment"
WHERE featureId = [FEATURE_ID] AND isActive = true
ORDER BY priority DESC;
```

### 2. Cost Calculation Issues

#### Problem: Costs show as $0.00 or wildly inaccurate

**Symptoms:**

- Dashboard shows zero costs despite usage
- Historical costs don't match expected values

**Diagnosis:**

```sql
-- Check if pricing data exists
SELECT m.modelKey, p.inputTokenPrice, p.outputTokenPrice, p.effectiveDate, p.isActive
FROM "LLMModel" m
LEFT JOIN "LLMPricing" p ON m.id = p.modelId
WHERE p.isActive = true OR p.id IS NULL
ORDER BY m.modelKey, p.effectiveDate DESC;

-- Check AI usage data
SELECT modelKey, COUNT(*), SUM(tokensIn), SUM(tokensOut)
FROM "AIUsage"
GROUP BY modelKey;
```

**Solutions:**

1. Add missing pricing data:

```sql
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive")
SELECT m.id, 0.0000025, 0.00001, '2024-01-01'::timestamp, 'MANUAL', true
FROM "LLMModel" m
WHERE m.modelKey = 'gpt-4o'
ON CONFLICT ("modelId", "effectiveDate", "source") DO NOTHING;
```

2. Fix missing model keys in usage data:

```sql
-- Update old records that don't have model keys
UPDATE "AIUsage"
SET modelKey = 'gpt-4o-mini'
WHERE modelKey IS NULL AND usageType IN ('TRANSLATION');

UPDATE "AIUsage"
SET modelKey = 'gpt-4o'
WHERE modelKey IS NULL AND usageType NOT IN ('TRANSLATION');
```

#### Problem: Pricing service returns null for valid dates

**Symptoms:**

- Warnings: "No pricing found for [model] at [date]"
- Fallback pricing being used incorrectly

**Diagnosis:**

```typescript
const pricingService = app.get(LLM_PRICING_SERVICE);
const pricing = await pricingService.getPricingAtDate("gpt-4o", new Date());
console.log("Pricing result:", pricing);
```

**Solutions:**

1. Check date ranges in pricing data:

```sql
SELECT modelKey, MIN(effectiveDate), MAX(effectiveDate), COUNT(*)
FROM "LLMPricing" p
JOIN "LLMModel" m ON p.modelId = m.id
GROUP BY modelKey;
```

2. Add historical baseline pricing:

```sql
-- Add pricing that covers all historical dates
INSERT INTO "LLMPricing" ("modelId", "inputTokenPrice", "outputTokenPrice", "effectiveDate", "source", "isActive")
SELECT m.id,
  CASE WHEN m.modelKey = 'gpt-4o' THEN 0.0000025 ELSE 0.00000015 END,
  CASE WHEN m.modelKey = 'gpt-4o' THEN 0.00001 ELSE 0.0000006 END,
  '2023-01-01'::timestamp, 'MANUAL', true
FROM "LLMModel" m
ON CONFLICT DO NOTHING;
```

### 3. Provider Integration Issues

#### Problem: New LLM provider not registering

**Symptoms:**

- Provider not available in router
- "No LLM provider registered for key" errors

**Diagnosis:**

```typescript
const router = app.get(LlmRouter);
const availableModels = router.getAvailableModelKeys();
console.log("Available models:", availableModels);
```

**Solutions:**

1. Check provider is in module injection:

```typescript
// Ensure provider is in ALL_LLM_PROVIDERS factory
{
  provide: ALL_LLM_PROVIDERS,
  useFactory: (p1, p2, newProvider) => [p1, p2, newProvider],
  inject: [Provider1, Provider2, NewProvider], // Must include all providers
}
```

2. Verify provider implements interface correctly:

```typescript
export class NewProvider implements ILlmProvider {
  readonly key = "new-model-key"; // Must be unique

  async invoke(messages: HumanMessage[]): Promise<LlmResponse> {
    // Must return proper structure
  }
}
```

#### Problem: Provider throws unexpected errors

**Symptoms:**

- API calls failing with unclear errors
- Inconsistent behavior across requests

**Diagnosis:**

```typescript
// Test provider directly
const provider = app.get(NewLlmService);
try {
  const result = await provider.invoke([new HumanMessage("Test")]);
  console.log("Success:", result);
} catch (error) {
  console.error("Provider error:", error);
}
```

**Solutions:**

1. Add comprehensive error handling:

```typescript
async invoke(messages: HumanMessage[]): Promise<LlmResponse> {
  try {
    const response = await this.client.createMessage({...});
    return this.formatResponse(response);
  } catch (error) {
    this.logger.error(`Provider error: ${error.message}`, {
      stack: error.stack,
      messages: messages.length,
      modelKey: this.key
    });

    if (this.isRetryableError(error)) {
      throw new RetryableError(error.message);
    }
    throw new ProviderError(`Failed to process request: ${error.message}`);
  }
}
```

### 4. Usage Tracking Issues

#### Problem: Usage not being tracked

**Symptoms:**

- AIUsage table empty or missing recent entries
- Dashboard shows no usage statistics

**Diagnosis:**

```sql
-- Check recent usage tracking
SELECT usageType, modelKey, COUNT(*), MAX(createdAt)
FROM "AIUsage"
WHERE createdAt > NOW() - INTERVAL '1 day'
GROUP BY usageType, modelKey;
```

**Solutions:**

1. Verify usage tracker is called:

```typescript
// In PromptProcessorService
await this.usageTracker.trackUsage(
  assignmentId,
  usageType,
  result.tokenUsage.input,
  result.tokenUsage.output,
  llm.key // Make sure this is included
);
```

2. Check for errors in usage tracking:

```typescript
try {
  await this.usageTracker.trackUsage(...);
} catch (error) {
  // Log but don't fail the main request
  this.logger.error('Failed to track usage:', error);
}
```

#### Problem: Model key not being stored in usage

**Symptoms:**

- AIUsage records have null modelKey
- Cost calculations falling back to guessing

**Solutions:**

1. Update usage tracking calls:

```typescript
// Old version (missing model key)
await this.usageTracker.trackUsage(
  assignmentId,
  usageType,
  tokensIn,
  tokensOut
);

// New version (with model key)
await this.usageTracker.trackUsage(
  assignmentId,
  usageType,
  tokensIn,
  tokensOut,
  llm.key
);
```

2. Backfill missing model keys:

```sql
-- Update based on usage patterns and dates
UPDATE "AIUsage"
SET modelKey = 'gpt-4o-mini'
WHERE modelKey IS NULL
  AND usageType = 'TRANSLATION';
```

### 5. Admin Interface Issues

#### Problem: Admin interface not loading model data

**Symptoms:**

- Loading indicators that never complete
- Empty tables or error messages

**Diagnosis:**

```bash
# Check API endpoints directly
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/v1/admin/llm-assignments/features

curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/v1/admin/llm-assignments/models
```

**Solutions:**

1. Check admin authentication:

```typescript
// Ensure proper admin token validation
const adminService = app.get(AdminService);
const isValid = await adminService.validateAdminToken(token);
```

2. Verify API responses:

```typescript
// Check controller returns proper format
{
  success: true,
  data: [...], // Array of features/models
  message: "Success"
}
```

#### Problem: Assignment changes not persisting

**Symptoms:**

- UI shows changes but reverts after refresh
- API calls appear successful but data unchanged

**Solutions:**

1. Check transaction handling:

```typescript
await this.prisma.$transaction(async (tx) => {
  // Deactivate old assignment
  await tx.lLMFeatureAssignment.updateMany({
    where: { featureId, isActive: true },
    data: { isActive: false, deactivatedAt: new Date() },
  });

  // Create new assignment
  await tx.lLMFeatureAssignment.create({
    data: { featureId, modelId, isActive: true, priority: 1 },
  });
});
```

2. Clear cache after changes:

```typescript
await this.resolverService.clearCache();
```

### 6. Performance Issues

#### Problem: Slow model resolution

**Symptoms:**

- API requests taking too long
- High database load from model queries

**Solutions:**

1. Check cache performance:

```typescript
const stats = await resolverService.getStats();
console.log("Cache hit ratio:", stats.hitRatio);
```

2. Optimize database queries:

```sql
-- Ensure proper indexing
CREATE INDEX IF NOT EXISTS idx_llm_assignment_feature_active
ON "LLMFeatureAssignment"(featureId, isActive) WHERE isActive = true;

CREATE INDEX IF NOT EXISTS idx_llm_pricing_model_date
ON "LLMPricing"(modelId, effectiveDate) WHERE isActive = true;
```

#### Problem: Memory leaks in caching layer

**Symptoms:**

- Increasing memory usage over time
- Cache growing without bounds

**Solutions:**

1. Configure cache TTL and size limits:

```typescript
const cache = new LRUCache({
  max: 1000, // Maximum number of items
  ttl: 5 * 60 * 1000, // 5 minutes
});
```

2. Monitor cache metrics:

```typescript
setInterval(() => {
  this.logger.info("Cache stats:", {
    size: this.cache.size,
    hits: this.cacheHits,
    misses: this.cacheMisses,
  });
}, 60000);
```

## Debugging Tools

### 1. Database Queries for Diagnostics

```sql
-- Complete system overview
SELECT
  f.featureKey,
  f.featureType,
  f.defaultModelKey,
  m.modelKey as assignedModel,
  lfa.priority,
  lfa.assignedAt,
  p.inputTokenPrice,
  p.outputTokenPrice
FROM "AIFeature" f
LEFT JOIN "LLMFeatureAssignment" lfa ON f.id = lfa.featureId AND lfa.isActive = true
LEFT JOIN "LLMModel" m ON lfa.modelId = m.id
LEFT JOIN "LLMPricing" p ON m.id = p.modelId AND p.isActive = true
ORDER BY f.featureKey;

-- Usage and cost analysis
SELECT
  u.modelKey,
  u.usageType,
  COUNT(*) as usage_count,
  SUM(u.tokensIn) as total_input_tokens,
  SUM(u.tokensOut) as total_output_tokens,
  AVG(p.inputTokenPrice * u.tokensIn + p.outputTokenPrice * u.tokensOut) as avg_cost
FROM "AIUsage" u
LEFT JOIN "LLMModel" m ON u.modelKey = m.modelKey
LEFT JOIN "LLMPricing" p ON m.id = p.modelId AND p.isActive = true
WHERE u.createdAt > NOW() - INTERVAL '7 days'
GROUP BY u.modelKey, u.usageType
ORDER BY total_input_tokens + total_output_tokens DESC;
```

### 2. Service Health Checks

```typescript
// Add to your health check controller
@Get('llm-health')
async checkLlmHealth() {
  const router = this.app.get(LlmRouter);
  const assignmentService = this.app.get(LLM_ASSIGNMENT_SERVICE);
  const pricingService = this.app.get(LLM_PRICING_SERVICE);

  return {
    availableModels: router.getAvailableModelKeys(),
    assignmentStats: await assignmentService.getAssignmentStatistics(),
    pricingStats: await pricingService.getPricingStatistics(),
    cacheStats: await this.resolverService.getStats()
  };
}
```

### 3. Log Analysis Patterns

```bash
# Find model resolution issues
grep "Failed to resolve model" logs/*.log

# Find pricing issues
grep "No pricing found" logs/*.log

# Find provider errors
grep "LLM provider error" logs/*.log

# Usage tracking failures
grep "Failed to track usage" logs/*.log
```

## Emergency Procedures

### 1. Disable Problematic Provider

```sql
UPDATE "LLMModel" SET isActive = false WHERE modelKey = 'problematic-model';
-- This will force fallback to default models
```

### 2. Reset to Default Assignments

```sql
-- Clear all assignments and let system use defaults
UPDATE "LLMFeatureAssignment" SET isActive = false;
-- Or run the reset API endpoint
curl -X POST -H "x-admin-token: TOKEN" http://localhost:3000/api/v1/admin/llm-assignments/reset-to-defaults
```

### 3. Clear All Caches

```typescript
// In emergency, restart the application or clear cache manually
await resolverService.clearCache();
```

## Monitoring and Alerting

Set up alerts for:

- High error rates from LLM providers
- Cost spikes indicating pricing issues
- Cache hit ratio dropping below 80%
- Usage tracking failures
- Model assignment changes

Example monitoring queries:

```sql
-- Daily cost by model
SELECT
  DATE(u.createdAt) as date,
  u.modelKey,
  SUM(p.inputTokenPrice * u.tokensIn + p.outputTokenPrice * u.tokensOut) as daily_cost
FROM "AIUsage" u
JOIN "LLMModel" m ON u.modelKey = m.modelKey
JOIN "LLMPricing" p ON m.id = p.modelId AND p.isActive = true
WHERE u.createdAt > NOW() - INTERVAL '30 days'
GROUP BY DATE(u.createdAt), u.modelKey
ORDER BY date DESC, daily_cost DESC;
```

---

_Keep this troubleshooting guide updated as new issues are discovered and resolved._
