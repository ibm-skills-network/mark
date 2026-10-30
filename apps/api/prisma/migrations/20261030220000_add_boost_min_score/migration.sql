-- AlterTable
ALTER TABLE "GradingBoostConfig" ADD COLUMN "minScorePercent" INTEGER NOT NULL DEFAULT 40;

ALTER TABLE "GradingBoostConfig" ADD CONSTRAINT "GradingBoostConfig_minScorePercent_check" CHECK ("minScorePercent" BETWEEN 0 AND 100);
