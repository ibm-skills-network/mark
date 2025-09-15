-- CreateTable
CREATE TABLE "LLMPriceUpscaling" (
    "id" SERIAL NOT NULL,
    "globalFactor" DOUBLE PRECISION,
    "usageTypeFactors" JSONB,
    "reason" TEXT,
    "appliedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMPriceUpscaling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LLMPriceUpscaling_isActive_effectiveDate_idx" ON "LLMPriceUpscaling"("isActive", "effectiveDate");

-- CreateIndex
CREATE INDEX "LLMPriceUpscaling_effectiveDate_idx" ON "LLMPriceUpscaling"("effectiveDate");
