-- CreateTable
CREATE TABLE "GradingJob" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER,
    "assignmentId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "percentage" INTEGER,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradingJob_attemptId_idx" ON "GradingJob"("attemptId");

-- CreateIndex
CREATE INDEX "GradingJob_assignmentId_idx" ON "GradingJob"("assignmentId");

-- CreateIndex
CREATE INDEX "GradingJob_userId_idx" ON "GradingJob"("userId");

-- CreateIndex
CREATE INDEX "GradingJob_status_idx" ON "GradingJob"("status");

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
