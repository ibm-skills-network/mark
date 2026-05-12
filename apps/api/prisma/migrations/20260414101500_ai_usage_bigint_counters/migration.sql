-- Upgrade AI usage counters to bigint to avoid overflow on long-lived rows.
ALTER TABLE "AIUsage"
  ALTER COLUMN "tokensIn" TYPE BIGINT,
  ALTER COLUMN "tokensOut" TYPE BIGINT,
  ALTER COLUMN "usageCount" TYPE BIGINT;
