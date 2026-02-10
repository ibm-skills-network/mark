-- CreateEnum
CREATE TYPE "LtiSyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'SCHEDULED');

-- CreateTable
CREATE TABLE "LtiGradeSync" (
    "id" SERIAL NOT NULL,
    "attemptId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "grade" DOUBLE PRECISION NOT NULL,
    "status" "LtiSyncStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "errorHistory" JSONB NOT NULL DEFAULT '[]',
    "authCookie" TEXT NOT NULL,
    "ltiGatewayUrl" TEXT,
    "learnerNotified" BOOLEAN NOT NULL DEFAULT false,
    "notificationSentAt" TIMESTAMP(3),

    CONSTRAINT "LtiGradeSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiSyncErrorLog" (
    "id" SERIAL NOT NULL,
    "syncId" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorStack" TEXT,
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "LtiSyncErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiGradeSync_attemptId_idx" ON "LtiGradeSync"("attemptId");

-- CreateIndex
CREATE INDEX "LtiGradeSync_userId_idx" ON "LtiGradeSync"("userId");

-- CreateIndex
CREATE INDEX "LtiGradeSync_status_idx" ON "LtiGradeSync"("status");

-- CreateIndex
CREATE INDEX "LtiGradeSync_nextRetryAt_idx" ON "LtiGradeSync"("nextRetryAt");

-- CreateIndex
CREATE INDEX "LtiGradeSync_createdAt_idx" ON "LtiGradeSync"("createdAt");

-- CreateIndex
CREATE INDEX "LtiSyncErrorLog_syncId_idx" ON "LtiSyncErrorLog"("syncId");

-- CreateIndex
CREATE INDEX "LtiSyncErrorLog_timestamp_idx" ON "LtiSyncErrorLog"("timestamp");

-- AddForeignKey
ALTER TABLE "LtiGradeSync" ADD CONSTRAINT "LtiGradeSync_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssignmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiSyncErrorLog" ADD CONSTRAINT "LtiSyncErrorLog_syncId_fkey" FOREIGN KEY ("syncId") REFERENCES "LtiGradeSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;
