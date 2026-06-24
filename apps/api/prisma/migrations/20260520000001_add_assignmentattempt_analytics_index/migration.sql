-- AddIndex: AssignmentAttempt analytics composite
-- CONCURRENTLY avoids a full table lock during index creation in production
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AssignmentAttempt_assignmentId_submitted_createdAt_idx"
  ON "AssignmentAttempt"("assignmentId", "submitted", "createdAt");
