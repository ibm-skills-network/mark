-- CreateEnum
CREATE TYPE "AssignmentFileExtractionStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "AssignmentFile" ADD COLUMN     "extractedAt" TIMESTAMP(3),
ADD COLUMN     "extractedText" TEXT,
ADD COLUMN     "extractionError" TEXT,
ADD COLUMN     "extractionStatus" "AssignmentFileExtractionStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "AssignmentFile_assignmentId_extractionStatus_idx" ON "AssignmentFile"("assignmentId", "extractionStatus");
