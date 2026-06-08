-- CreateIndex
CREATE INDEX "AIUsage_assignmentId_createdAt_usageType_modelKey_idx" ON "AIUsage"("assignmentId", "createdAt", "usageType", "modelKey");

-- CreateIndex
CREATE INDEX "AssignmentAttempt_assignmentId_submitted_createdAt_idx" ON "AssignmentAttempt"("assignmentId", "submitted", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionResponse_questionId_assignmentAttemptId_idx" ON "QuestionResponse"("questionId", "assignmentAttemptId");
