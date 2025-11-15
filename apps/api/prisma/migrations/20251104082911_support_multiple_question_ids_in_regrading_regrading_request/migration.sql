-- AlterTable
ALTER TABLE "RegradingRequest" ADD COLUMN     "processedBy" TEXT,
ADD COLUMN     "proposedGrade" DOUBLE PRECISION,
ADD COLUMN     "questionIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
