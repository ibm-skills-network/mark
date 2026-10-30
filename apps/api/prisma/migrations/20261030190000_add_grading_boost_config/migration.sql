-- CreateTable
CREATE TABLE "GradingBoostConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerStep" INTEGER NOT NULL DEFAULT 4,
    "maxBoost" INTEGER NOT NULL DEFAULT 3,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingBoostConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GradingBoostConfig_single_row_check" CHECK ("id" = 1),
    CONSTRAINT "GradingBoostConfig_pointsPerStep_check" CHECK ("pointsPerStep" BETWEEN 1 AND 100),
    CONSTRAINT "GradingBoostConfig_maxBoost_check" CHECK ("maxBoost" BETWEEN 0 AND 20)
);
