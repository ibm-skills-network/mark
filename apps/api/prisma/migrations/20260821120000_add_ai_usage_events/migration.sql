-- Add an auditable provider-call ledger while retaining the AIUsage aggregate.
ALTER TABLE "AIUsage"
  ADD COLUMN "cachedTokensIn" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "AIUsageEvent" (
  "id" SERIAL NOT NULL,
  "assignmentId" INTEGER NOT NULL,
  "usageType" "AIUsageType" NOT NULL,
  "tokensIn" BIGINT NOT NULL,
  "cachedTokensIn" BIGINT NOT NULL DEFAULT 0,
  "tokensOut" BIGINT NOT NULL,
  "modelKey" TEXT NOT NULL,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isEstimated" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "AIUsageEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AIUsageEvent"
  ADD CONSTRAINT "AIUsageEvent_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AIUsageEvent"
  ADD CONSTRAINT "AIUsageEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "UserCredential"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AIUsageEvent_assignmentId_createdAt_usageType_modelKey_idx"
  ON "AIUsageEvent"("assignmentId", "createdAt", "usageType", "modelKey");

CREATE INDEX "AIUsageEvent_createdAt_isEstimated_idx"
  ON "AIUsageEvent"("createdAt", "isEstimated");

-- Backfill aggregate totals as estimated events because per-call timestamps are unavailable.
INSERT INTO "AIUsageEvent" (
  "assignmentId", "usageType", "tokensIn", "cachedTokensIn", "tokensOut", "modelKey",
  "userId", "createdAt", "isEstimated"
)
SELECT
  "assignmentId",
  "usageType",
  "tokensIn",
  "cachedTokensIn",
  "tokensOut",
  COALESCE("modelKey", 'unknown'),
  "userId",
  "createdAt",
  true
FROM "AIUsage";
