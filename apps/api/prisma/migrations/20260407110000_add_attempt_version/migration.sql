-- AddColumn: AssignmentAttempt.version for optimistic locking
-- Additive migration — zero downtime, no data loss
ALTER TABLE "AssignmentAttempt"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
