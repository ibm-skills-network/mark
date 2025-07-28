-- CreateTable
CREATE TABLE "GradingAudit" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "assignmentId" INTEGER,
    "requestPayload" TEXT NOT NULL,
    "responsePayload" TEXT NOT NULL,
    "gradingStrategy" TEXT NOT NULL,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradingAudit_questionId_idx" ON "GradingAudit"("questionId");

-- CreateIndex
CREATE INDEX "GradingAudit_assignmentId_idx" ON "GradingAudit"("assignmentId");

-- CreateIndex
CREATE INDEX "GradingAudit_timestamp_idx" ON "GradingAudit"("timestamp");

-- AddForeignKey
ALTER TABLE "GradingAudit" ADD CONSTRAINT "GradingAudit_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingAudit" ADD CONSTRAINT "GradingAudit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
