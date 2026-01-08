-- CreateEnum
CREATE TYPE "GradingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "GradingProgress" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "status" "GradingStatus" NOT NULL DEFAULT 'PENDING',
    "currentQuestion" INTEGER,
    "totalQuestions" INTEGER NOT NULL,
    "currentStage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notifyOnComplete" BOOLEAN NOT NULL DEFAULT false,
    "notificationEmail" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradingProgress_attemptId_key" ON "GradingProgress"("attemptId");

-- CreateIndex
CREATE INDEX "GradingProgress_attemptId_idx" ON "GradingProgress"("attemptId");

-- CreateIndex
CREATE INDEX "GradingProgress_status_idx" ON "GradingProgress"("status");

-- CreateIndex
CREATE INDEX "GradingProgress_notifyOnComplete_idx" ON "GradingProgress"("notifyOnComplete");

-- AddForeignKey
ALTER TABLE "GradingProgress" ADD CONSTRAINT "GradingProgress_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
