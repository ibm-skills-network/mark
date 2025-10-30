-- AlterTable
ALTER TABLE "AIUsage" ADD COLUMN     "inputCost" DOUBLE PRECISION,
ADD COLUMN     "inputTokenPrice" DOUBLE PRECISION,
ADD COLUMN     "outputCost" DOUBLE PRECISION,
ADD COLUMN     "outputTokenPrice" DOUBLE PRECISION,
ADD COLUMN     "pricingDate" TIMESTAMP(3),
ADD COLUMN     "totalCost" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "AIUsage_assignmentId_createdAt_usageType_modelKey_idx" ON "AIUsage"("assignmentId", "createdAt", "usageType", "modelKey");

-- CreateIndex
CREATE INDEX "AssignmentAttempt_assignmentId_submitted_createdAt_idx" ON "AssignmentAttempt"("assignmentId", "submitted", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionResponse_questionId_assignmentAttemptId_idx" ON "QuestionResponse"("questionId", "assignmentAttemptId");
