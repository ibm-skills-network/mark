-- CreateEnum
CREATE TYPE "QuestionDisplay" AS ENUM ('ONE_PER_PAGE', 'ALL_PER_PAGE');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "questionDisplay" "QuestionDisplay" DEFAULT 'ONE_PER_PAGE';
