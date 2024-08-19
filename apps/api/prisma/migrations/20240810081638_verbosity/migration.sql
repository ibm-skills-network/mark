/*
  Warnings:

  - You are about to drop the column `numRetries` on the `Question` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "showSubmissionFeedback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showAssignmentScore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showQuestionScore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Question" DROP COLUMN "numRetries";