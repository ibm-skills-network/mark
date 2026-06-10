-- AddIndex: AIUsage analytics composite
-- CONCURRENTLY avoids a full table lock during index creation in production
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AIUsage_assignmentId_createdAt_usageType_modelKey_idx"
  ON "AIUsage"("assignmentId", "createdAt", "usageType", "modelKey");
