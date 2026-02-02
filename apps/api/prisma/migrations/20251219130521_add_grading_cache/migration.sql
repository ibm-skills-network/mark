-- CreateTable
CREATE TABLE "GradingCache" (
    "id" SERIAL NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "questionId" INTEGER NOT NULL,
    "rubricHash" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "criteria" JSONB NOT NULL,
    "overallFeedback" TEXT NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "GradingCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradingCache_cacheKey_key" ON "GradingCache"("cacheKey");

-- CreateIndex
CREATE INDEX "GradingCache_questionId_idx" ON "GradingCache"("questionId");

-- CreateIndex
CREATE INDEX "GradingCache_rubricHash_idx" ON "GradingCache"("rubricHash");

-- CreateIndex
CREATE INDEX "GradingCache_answerHash_idx" ON "GradingCache"("answerHash");

-- CreateIndex
CREATE INDEX "GradingCache_cachedAt_idx" ON "GradingCache"("cachedAt");

-- AddForeignKey
ALTER TABLE "GradingCache" ADD CONSTRAINT "GradingCache_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
