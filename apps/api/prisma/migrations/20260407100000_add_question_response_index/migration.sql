-- AddIndex: QuestionResponse.assignmentAttemptId
-- CONCURRENTLY avoids a full table lock during index creation in production
CREATE INDEX CONCURRENTLY IF NOT EXISTS "QuestionResponse_assignmentAttemptId_idx"
  ON "QuestionResponse"("assignmentAttemptId");
