-- AddIndex: QuestionResponse analytics composite
-- CONCURRENTLY avoids a full table lock during index creation in production
CREATE INDEX CONCURRENTLY IF NOT EXISTS "QuestionResponse_questionId_assignmentAttemptId_idx"
  ON "QuestionResponse"("questionId", "assignmentAttemptId");
