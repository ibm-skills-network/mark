-- CreateTable
CREATE TABLE "AIUsageDaily" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "usageType" "AIUsageType" NOT NULL,
    "modelKey" TEXT NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "cachedInputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "calls" BIGINT NOT NULL DEFAULT 0,
    "failedCalls" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AIUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AIUsageDaily_day_usageType_modelKey_assignmentId_key" ON "AIUsageDaily"("day", "usageType", "modelKey", "assignmentId");
